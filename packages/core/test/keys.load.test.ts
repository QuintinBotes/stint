import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/schemas/config';
import { loadKeys } from '../src/keys';
import { tempDir, withFixtureRepo } from './fixture';

const cli = join(import.meta.dir, '..', '..', 'cli', 'bin', 'stint');
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** A home whose user-level key file holds META_API_KEY only, and an empty checkout so the real one is never read. */
function home(mode: number): { env: Record<string, string>; checkout: string } {
  const h = tempDir('stint-home-');
  const c = tempDir('stint-checkout-');
  cleanups.push(h.cleanup, c.cleanup);
  mkdirSync(join(h.dir, '.config', 'stint'), { recursive: true });
  const file = join(h.dir, '.config', 'stint', 'env');
  writeFileSync(file, 'META_API_KEY=key-from-the-user-file\n');
  chmodSync(file, mode);
  return { env: { HOME: h.dir, PATH: process.env.PATH ?? '' }, checkout: c.dir };
}

test('R-059 Acceptance 4: with META_API_KEY only in the user-level env file, stint up --check, run from another repository, reports it with source user', async () => {
  await withFixtureRepo(async (repo) => {
    const { env } = home(0o600);
    // the Meta host answers from this process, so checking the key never leaves the machine
    const fake = Bun.serve({ port: 0, fetch: () => Response.json({ data: [{ id: 'muse-spark-1.3' }] }) });
    try {
      mkdirSync(join(repo, '.stint'), { recursive: true });
      const config = structuredClone(DEFAULT_CONFIG);
      config.hosts['meta-api'] = { ...(config.hosts['meta-api'] as NonNullable<(typeof config.hosts)[string]>), baseURL: `http://127.0.0.1:${fake.port}/v1` };
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      const p = Bun.spawn(['bun', cli, 'up', '--check', '--json', '--repo', repo], { cwd: repo, env, stdout: 'pipe', stderr: 'pipe' });
      const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
      const report = JSON.parse(out.trim().split('\n').at(-1) as string) as { keys: Record<string, string> };
      expect(report.keys.META_API_KEY).toBe('user');
      expect(out).not.toContain('key-from-the-user-file');
      expect([0, 1]).toContain(code);
    } finally {
      fake.stop(true);
    }
  });
}, 60_000);

test('R-059 Acceptance 4: a tracked .env is refused and never read', async () => {
  await withFixtureRepo(async (repo) => {
    const { env, checkout } = home(0o600);
    writeFileSync(join(repo, '.env'), 'META_API_KEY=key-from-a-tracked-file\nFIREWORKS_API_KEY=also-tracked\n');
    Bun.spawnSync(['git', '-C', repo, 'add', '-f', '.env']);
    Bun.spawnSync(['git', '-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'track .env']);
    const r = loadKeys(repo, { env, checkout });
    expect(r.refusals.some((x) => x.includes('tracked by git'))).toBe(true);
    expect(r.values.META_API_KEY).toBe('key-from-the-user-file');
    expect(r.sources.META_API_KEY).toBe('user');
    expect(r.sources.FIREWORKS_API_KEY).toBe('missing');
    expect(Object.values(r.values)).not.toContain('also-tracked');
  });
});

test('R-059 Acceptance 4: a 0644 user file warns', async () => {
  await withFixtureRepo(async (repo) => {
    const { env, checkout } = home(0o644);
    const said: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      said.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(loadKeys(repo, { env, checkout }).sources.META_API_KEY).toBe('user');
    } finally {
      process.stderr.write = write;
    }
    expect(said.join('')).toContain('can be read by others (mode 644)');
    expect(said.join('')).not.toContain('key-from-the-user-file');
  });
});

test('an ignored repo .env is read before the user file, and the old checkout .env comes last with a note', async () => {
  await withFixtureRepo(async (repo) => {
    const { env, checkout } = home(0o600);
    writeFileSync(join(repo, '.gitignore'), '.env\n');
    writeFileSync(join(repo, '.env'), 'META_API_KEY=key-from-the-repo\n');
    writeFileSync(join(checkout, '.env'), 'BASETEN_API_KEY=key-from-the-checkout\n');
    const r = loadKeys(repo, { env, checkout });
    expect(r.sources.META_API_KEY).toBe('repo');
    expect(r.values.META_API_KEY).toBe('key-from-the-repo');
    expect(r.sources.BASETEN_API_KEY).toBe('checkout');
    expect(loadKeys(repo, { env: { ...env, META_API_KEY: 'from-the-shell' }, checkout }).sources.META_API_KEY).toBe('env');
  });
});
