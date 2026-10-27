import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace, similarText } from '@stint-dev/core/node';
import { importSkill } from '@stint-dev/daemon';
import { tempDir, withFixtureRepo } from '../../core/test/fixture';
import { pickSimilarEvalTasks } from '../src/eval/results';

const bin = join(import.meta.dir, '..', 'bin', 'stint');

const skillMd =
  '---\nname: limiter-config-via-env\ndescription: "Use when adding a rate limit, threshold or webhook limit: read it from config, never as a constant."\ntags: [limits]\n---\n\n# Limits come from config\n\nEvery limit is read through loadConfig().\n';

function seedRow(dir: string, task: string, withSkill: boolean, findings: number): void {
  const at = join(dir, `${task}-${withSkill ? 'with' : 'without'}`);
  mkdirSync(at, { recursive: true });
  writeFileSync(
    join(at, 'row.json'),
    `${JSON.stringify({ task, withSkill, findings, passed: 30, failed: 0, verified: true, inputTokens: 1000, cachedTokens: 0, outputTokens: 100, usd: 0, synthetic: true }, null, 2)}\n`,
  );
}

test('stint eval --skill <imported> --replay names the similar tasks it used', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    // the imported proposal, with no evidence tasks of its own
    await importSkill(ws, {
      files: [{ path: 'SKILL.md', bytes: new TextEncoder().encode(skillMd) }],
      source: { kind: 'folder', ref: 'acme-skills' },
    });
    // tasks like the skill, and ones nothing like it
    await ws.createTask({ id: 'T-0040', title: 'Audit the export rate limit', goal: 'Check the webhook rate limit threshold.', acceptance: ['done'], testCommand: 'bun run test', tags: ['limits'] });
    await ws.createTask({ id: 'T-0042', title: 'Rate-limit incoming webhooks', goal: 'Answer 429 when over the rate limit threshold.', acceptance: ['429'], testCommand: 'bun run test', tags: ['limits'] });
    await ws.createTask({ id: 'T-0050', title: 'Paint the settings page', goal: 'Fresh colours for the settings screen.', acceptance: ['done'], testCommand: 'bun run test', tags: ['ui'] });

    // the live path picks these same tasks by similarity, narrowed to the shared tag
    const similar = await similarText(ws, { title: 'limiter-config-via-env', goal: 'Use when adding a rate limit, threshold or webhook limit' }, 10);
    const picked = pickSimilarEvalTasks(similar, await ws.listTasks(), ['limits']).map((t) => t.id);
    expect(picked).toContain('T-0042');
    expect(picked).not.toContain('T-0050');

    const runs = tempDir('stint-eval-runs-');
    try {
      for (const task of ['T-0040', 'T-0042']) {
        seedRow(runs.dir, task, true, 0);
        seedRow(runs.dir, task, false, 2);
      }
      const r = Bun.spawnSync(['bun', bin, 'eval', '--skill', 'limiter-config-via-env', '--replay', '--from', runs.dir, '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
      expect(r.exitCode, r.stderr.toString()).toBe(0);
      const out = r.stdout.toString();
      expect(out).toContain('Tasks used: T-0040, T-0042');
      expect(out).not.toContain('T-0050');

      const evalPath = join(repo, '.stint', 'evals', 'limiter-config-via-env.json');
      expect(existsSync(evalPath)).toBe(true);
      const file = JSON.parse(readFileSync(evalPath, 'utf8')) as { tasks: string[]; replay: boolean };
      expect(file.replay).toBe(true);
      expect(file.tasks).toEqual(['T-0040', 'T-0042']);
    } finally {
      runs.cleanup();
    }
  });
}, 120_000);
