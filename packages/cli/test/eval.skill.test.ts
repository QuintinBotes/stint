import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { daemonContext } from '@stint-dev/daemon';
import { tempDir } from '../../core/test/fixture';
import { fakeModels } from '../../daemon/test/autopilot.fixtures';
import { fakeAdapter, withFixtureRepo } from '../../daemon/test/helpers';
import { freshFixture } from '../src/demo';
import { runSkillEvalLive } from '../src/eval/live';
import { type SkillEvalFile, resolveSkillEvalTasks } from '../src/eval/results';

const bin = join(import.meta.dir, '..', 'bin', 'stint');
const fixtures = join(import.meta.dir, 'fixtures', 'evals', 'limiter-config-via-env', 'runs');
const CARD = 'with skill: 1 findings, 99 passed, cost $0.0385; without: 5 findings, 97 passed, cost $0.0355';

function skillFile(repo: string): void {
  const dir = join(repo, '.agents', 'skills', 'limiter-config-via-env');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    [
      '---',
      'name: limiter-config-via-env',
      'description: "Use when adding a limit, threshold, window or cap: read it through loadConfig() with a default, never as a constant."',
      'roles: [implementer, reviewer]',
      'tags: [limits, config]',
      'origin: learn-loop',
      'evidence: ["T-0042/r4#F1", "T-0040/r3#F2"]',
      'status: probation',
      '---',
      '',
      'Every limit is read through loadConfig() with a default.',
      '',
    ].join('\n'),
  );
}

test('stint eval --skill limiter-config-via-env --replay on recorded runs writes the eval file and the card text', async () => {
  await withFixtureRepo(async (repo) => {
    skillFile(repo);
    const ws = await Workspace.open(repo);
    await ws.createTask({ id: 'T-0042', title: 'Rate-limit incoming webhooks', goal: 'Answer 429 over the limit.', acceptance: ['429 with Retry-After'], testCommand: 'bun run test', tags: ['limits'] });

    const r = Bun.spawnSync(['bun', bin, 'eval', '--skill', 'limiter-config-via-env', '--replay', '--from', fixtures, '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    expect(r.stdout.toString()).toContain(CARD);

    const path = join(repo, '.stint', 'evals', 'limiter-config-via-env.json');
    expect(existsSync(path)).toBe(true);
    const file = JSON.parse(readFileSync(path, 'utf8')) as SkillEvalFile;
    expect(file.version).toBe('stint.skillEval/1');
    expect(file.replay).toBe(true);
    expect(file.synthetic).toBe(true);
    expect(file.heldOut).toBe('T-0043');
    expect(file.tasks).toEqual(['T-0040', 'T-0042', 'T-0043']);
    expect(file.with).toMatchObject({ runs: 3, findings: 1, passed: 99, failed: 0, verified: 3, usd: 0.0385 });
    expect(file.without).toMatchObject({ runs: 3, findings: 5, passed: 97, failed: 2, verified: 2, usd: 0.0355 });
    expect(file.card).toBe(CARD);
    expect(file.rows).toHaveLength(6);

    const evaluated = (await ws.events('T-0042').read()).find((e) => e.type === 'skill.evaluated');
    expect(evaluated?.payload.id).toBe('limiter-config-via-env');
    expect((evaluated?.payload.with as { findings: number }).findings).toBe(1);
    expect((evaluated?.payload.without as { findings: number }).findings).toBe(5);
  });
}, 120_000);

test('the eval tasks are the evidence tasks plus the most recent other task with the same tags', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const mk = (id: string, title: string, tags: string[]) => ws.createTask({ id, title, goal: 'Do the thing.', acceptance: ['done'], testCommand: 'bun run test', tags });
    await mk('T-0040', 'Audit export limit', ['limits']);
    await mk('T-0042', 'Rate-limit webhooks', ['limits']);
    await mk('T-0043', 'Rate-limit the admin API', ['limits', 'admin']);
    const { defs, heldOut } = resolveSkillEvalTasks({ evidence: ['T-0042/r4#F1', 'T-0040/r3#F2'], tags: ['limits', 'config'], tasks: await ws.listTasks() });
    expect(defs.map((d) => d.id)).toEqual(['T-0042', 'T-0040', 'T-0043']);
    expect(heldOut).toBe('T-0043');
    expect(defs[2]?.heldOut).toBe(true);
    expect(defs[0]?.testCommand).toBe('bun run test');
  });
}, 60_000);

test('the live eval runs each task with the skill mounted and with its folder removed, and records findings from the review', async () => {
  await withFixtureRepo(async (repo) => {
    skillFile(repo);
    const out = tempDir('stint-eval-live-');
    try {
      const rows = await runSkillEvalLive({
        root: repo,
        skillId: 'limiter-config-via-env',
        proposal: null,
        tasks: [{ id: 'T-0042', title: 'Rate-limit incoming webhooks', goal: 'Answer 429 over the limit.', acceptance: ['429 with Retry-After'], testCommand: 'true', tags: ['limits'] }],
        implementer: 'fake',
        outRunsDir: join(out.dir, 'runs'),
        adapters: () => [fakeAdapter('edit')],
        makeFixture: () => freshFixture(),
        // the faked reviewer chain: the mounted skill is named in the prompt the run started from
        review: async (app, taskId) => {
          const prompt = (await daemonContext(app).ws.runs(taskId).readPrompt('r1')) ?? '';
          return prompt.includes('limiter-config-via-env') ? 0 : 2;
        },
        synthetic: true,
      });
      expect(rows).toHaveLength(2);
      const withRow = rows.find((r) => r.withSkill);
      const withoutRow = rows.find((r) => !r.withSkill);
      expect(withRow).toMatchObject({ findings: 0, verified: true, synthetic: true });
      expect(withoutRow).toMatchObject({ findings: 2, verified: true, synthetic: true });
      expect(readFileSync(join(out.dir, 'runs', 'T-0042-with', 'prompt.md'), 'utf8')).toContain('limiter-config-via-env');
      expect(readFileSync(join(out.dir, 'runs', 'T-0042-without', 'prompt.md'), 'utf8')).not.toContain('limiter-config-via-env');
      expect(existsSync(join(out.dir, 'runs', 'T-0042-with', 'row.json'))).toBe(true);
    } finally {
      out.cleanup();
    }
  });
}, 180_000);

test('the live eval takes findings from the reviewer chain, faked here as a model server', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      skillFile(repo);
      const config = structuredClone(DEFAULT_CONFIG) as Config;
      config.hosts.ollama = { ...(config.hosts.ollama as Config['hosts']['ollama']), baseURL: models.url, models: { fake: 'fake' } };
      config.routes.reviewer = ['ollama/fake'];
      config.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      const out = tempDir('stint-eval-chain-');
      try {
        const rows = await runSkillEvalLive({
          root: repo,
          skillId: 'limiter-config-via-env',
          proposal: null,
          tasks: [{ id: 'T-0042', title: 'Rate-limit incoming webhooks', goal: 'Answer 429 over the limit.', acceptance: ['429 with Retry-After'], testCommand: 'true', tags: ['limits'] }],
          implementer: 'fake',
          outRunsDir: join(out.dir, 'runs'),
          adapters: () => [fakeAdapter('edit')],
          makeFixture: () => freshFixture(),
          synthetic: true,
        });
        // the fake reviewer's verdict is approve with no findings, on both sides
        expect(rows.map((r) => r.findings)).toEqual([0, 0]);
        expect(models.asked).toEqual(['review', 'review']);
      } finally {
        out.cleanup();
      }
    });
  } finally {
    models.stop();
  }
}, 180_000);
