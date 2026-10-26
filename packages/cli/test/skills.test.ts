import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';
import { withFixtureRepo } from '../../daemon/test/helpers';

test('stint skills list prints both with their origin', async () => {
  await withFixtureRepo(async (repo) => {
    mkdirSync(join(repo, '.agents', 'skills', 'limiter-config-via-env'), { recursive: true });
    writeFileSync(
      join(repo, '.agents', 'skills', 'limiter-config-via-env', 'SKILL.md'),
      [
        '---',
        'name: limiter-config-via-env',
        'description: "Use when adding a limit, threshold, window or cap: read it through loadConfig() with a default, never as a constant."',
        'roles: ["implementer", "reviewer"]',
        'tags: ["limits", "config"]',
        'version: 1.0.0',
        'origin: learn-loop',
        'evidence: ["T-0042/r4#F1", "T-0040/r3#F2"]',
        'status: active',
        '---',
        '',
        '# Limits come from config',
        '',
        'Every limit is read through loadConfig().',
        '',
      ].join('\n'),
    );
    const d = await startDaemon({ root: repo, quiet: true, adapters: [] });
    try {
      const bin = join(import.meta.dir, '..', 'bin', 'stint');
      // async spawn: the daemon under test serves from this same process
      const runCli = async (args: string[]) => {
        const p = Bun.spawn(['bun', bin, ...args], { stdout: 'pipe', stderr: 'pipe' });
        const out = await new Response(p.stdout).text();
        expect(await p.exited).toBe(0);
        return out;
      };
      const out = await runCli(['skills', 'list', '--repo', repo]);
      expect(out).toContain('review-voice-policy');
      expect(out).toContain('human');
      expect(out).toContain('limiter-config-via-env');
      expect(out).toContain('learn-loop');

      const rows = JSON.parse(await runCli(['skills', 'list', '--repo', repo, '--json'])) as Array<{ id: string; origin: string; status: string }>;
      expect(rows.find((s) => s.id === 'review-voice-policy')).toMatchObject({ origin: 'human', status: 'active' });
      expect(rows.find((s) => s.id === 'limiter-config-via-env')).toMatchObject({ origin: 'learn-loop', status: 'active' });
    } finally {
      await d.stop();
    }
  });
}, 60_000);
