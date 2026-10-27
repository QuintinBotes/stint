import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Adapter, DEFAULT_CONFIG } from '@stint-dev/core';
import { startDaemon } from '@stint-dev/daemon';
import { tempDir, withFixtureRepo } from '../../core/test/fixture';

const cli = join(import.meta.dir, '..', 'bin', 'stint');
type Report = { ok: boolean; checks: Array<{ id: string; status: 'ok' | 'warn' | 'fail'; reason: string; fix?: string }> };

/** Ollama points at a port nothing listens on, so the check is the same on every machine. */
function initialise(repo: string): void {
  mkdirSync(join(repo, '.stint'), { recursive: true });
  const config = structuredClone(DEFAULT_CONFIG);
  config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<(typeof config.hosts)[string]>), baseURL: 'http://127.0.0.1:9/v1' };
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
}

async function doctor(repo: string): Promise<{ code: number; report: Report }> {
  const home = tempDir('stint-doctor-home-');
  try {
    // async, not spawnSync: the daemon answering the doctor runs in this process
    const p = Bun.spawn(['bun', cli, 'doctor', '--json', '--repo', repo], { cwd: repo, env: { HOME: home.dir, PATH: process.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe' });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    return { code, report: JSON.parse(out) as Report };
  } finally {
    home.cleanup();
  }
}

const status = (r: Report, id: string) => r.checks.find((c) => c.id === id)?.status;

const fake = (id: string): Adapter => ({
  id,
  vendor: 'meta',
  roles: ['implementer'],
  capabilities: { editsFiles: true, runsCommands: false, resumable: false, structuredOutput: false, offline: true },
  available: async () => ({ ok: true, version: 'fake 1' }),
  gate: () => 'none',
  run: async () => ({ endedBy: 'completed', cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0 } }),
});

test('R-059 Acceptance 5: stint doctor --json on a dirty fixture with no daemon fails repo.clean and daemon, warns ollama, and exits 1', async () => {
  await withFixtureRepo(async (repo) => {
    initialise(repo);
    writeFileSync(join(repo, 'README.md'), 'changed and not committed\n');
    const { code, report } = await doctor(repo);
    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    expect(status(report, 'repo.clean')).toBe('fail');
    expect(status(report, 'daemon')).toBe('fail');
    expect(status(report, 'ollama')).toBe('warn');
    for (const c of report.checks.filter((x) => x.status === 'fail')) expect(c.fix?.length).toBeGreaterThan(0);
  });
}, 60_000);

test('R-059 Acceptance 5: on a clean fixture with the daemon up and fake agents, it exits 0', async () => {
  await withFixtureRepo(async (repo) => {
    initialise(repo);
    const d = await startDaemon({ root: repo, quiet: true, adapters: [fake('muse-code'), fake('stint-agent')] });
    try {
      const { code, report } = await doctor(repo);
      expect(report.checks.filter((c) => c.status === 'fail')).toEqual([]);
      expect(code).toBe(0);
      expect(status(report, 'daemon')).toBe('ok');
      expect(status(report, 'agent.muse-code')).toBe('ok');
      expect(status(report, 'repo.clean')).toBe('ok');
    } finally {
      await d.stop();
    }
  });
}, 60_000);
