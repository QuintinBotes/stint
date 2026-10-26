import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { Workspace, runsFromEvents } from '@stint-dev/core/node';
import { startDaemon } from '@stint-dev/daemon';
import { fakeModels } from '../../daemon/test/autopilot.fixtures';
import { fakeAdapter, withFixtureRepo } from '../../daemon/test/helpers';
import { report, writeTable } from '../src/report';
import { taskFromSpec, waitForStop } from '../src/tasks';
import { withReplay } from './replay';

test('stint report on the replay prints the spend per task and agent and the review verdicts', async () => {
  await withReplay(async (root) => {
    const r = await report(root);
    const ws = await Workspace.open(root);
    for (const t of await ws.listTasks()) {
      const events = await ws.events(t.id).read();
      for (const run of runsFromEvents(events).filter((x) => x.endedAt)) {
        const agent = run.adapter === 'openai-compatible' ? `${run.role}:${run.host}` : run.adapter;
        expect(r.spend.some((l) => l.includes(`| ${t.id} |`) && l.includes(`${agent}`) && l.includes(` ${run.run} |`))).toBe(true);
      }
      const verdicts = events.filter((e) => e.type === 'review.recorded').map((e) => String(e.payload.verdict).replace('_', ' '));
      expect(r.reviews.filter((l) => l.startsWith(`| ${t.id} |`)).map((l) => l.split('|')[3]?.trim())).toEqual(verdicts);
    }
    expect(r.spend.some((l) => l.includes('muse-code/muse-spark-1.3'))).toBe(true);
    expect(r.reviews.length).toBeGreaterThan(0);
  });
}, 120_000);

test('stint report --write replaces its own rows and keeps the rows the loop wrote, the same on a second write', () => {
  const doc = ['# Progress', '', '## Reviews', '', '| Spec | Attempt | Verdict | Reviewer | Findings | File |', '|---|---|---|---|---|---|', '| R-010 | 1 | approve | muse-code/muse-spark-1.3 | 0 | .loop/logs/x.log |', '| T-0001 | 1 | block | old | 2 | old |', '', '## Spend', '', '| When | Spec | Agent | Tokens in/out | USD | Wall |', '|---|---|---|---|---|---|', '| 09:00 | R-010 | muse-code/muse-wonder | see log | $0.40 | 300s |', '', '## Ideas', ''].join('\n');
  const review = '| R-047 (T-0050) | 1 | approve | meta-api/muse-spark-1.3 | 0 | .stint/tasks/T-0050/reviews/r3.json |';
  const cost = '| 2026-10-26 10:00 | R-047 (T-0050) | muse-code/muse-spark-1.3 r1 | 100/20 | $0.01 | 60s |';
  const reviews = [review];
  const spend = [cost];
  const once = writeTable(writeTable(doc, '## Reviews', reviews), '## Spend', spend);
  expect(once).toContain('| R-010 | 1 | approve | muse-code/muse-spark-1.3 | 0 | .loop/logs/x.log |');
  expect(once).not.toContain('| T-0001 | 1 | block | old | 2 | old |');
  expect(once).toContain(review);
  expect(once).toContain('| 09:00 | R-010 | muse-code/muse-wonder | see log | $0.40 | 300s |');
  expect(once).toContain(cost);
  expect(once).toContain('## Ideas');
  expect(writeTable(writeTable(once, '## Reviews', reviews), '## Spend', spend)).toBe(once);
});

test('A spec file becomes a task with its title, goal, acceptance, verify command and spec tag', () => {
  const t = taskFromSpec(readFileSync(join(import.meta.dir, '..', '..', '..', 'specs', 'R-047-self-hosting.md'), 'utf8'));
  expect(t.title).toBe('R-047: Stint builds Stint');
  expect(t.goal).toStartWith('The build process is the product.');
  expect(t.acceptance).toHaveLength(1);
  expect(t.acceptance[0]).toStartWith('`stint report` on the replay prints');
  expect(t.testCommand).toBe('bun run typecheck && bash scripts/check.sh');
  expect(t.tags).toEqual(['spec', 'R-047']);
  expect(() => taskFromSpec('# Not a spec')).toThrow('not a spec');
});

test('stint run --wait stops at the approval gate and never passes it', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<typeof config.hosts.ollama>), baseURL: models.url, models: { fake: 'fake' } };
      config.routes.planner = ['ollama/fake'];
      config.routes.reviewer = ['ollama/fake'];
      config.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
      config.autopilot = { implementers: ['muse-code'], maxHops: 2, parallel: 1 };
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...fakeAdapter('edit'), id: 'muse-code' }] });
      try {
        const spec = taskFromSpec('# R-099 · A small change\n\n## Goal\nChange one line.\n\n## Acceptance\n1. One line changes.\n\n## Verify\n```\ntrue\n```\n');
        const post = (path: string, body: unknown) => fetch(`${d.url}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const t = (await (await post('/api/tasks', spec)).json()) as { id: string; tags: string[] };
        expect(t.tags).toEqual(['spec', 'R-099']);
        await post(`/api/tasks/${t.id}/autopilot`, { on: true });
        const stop = await waitForStop(repo, t.id, 50);
        expect(stop).toEqual({ reason: 'Waiting for your approval.', needsYou: false });
        const events = await d.ws.events(t.id).read();
        expect(events.some((e) => e.type === 'approval.granted' || e.type === 'merge.completed')).toBe(false);
        expect((await d.ws.readTask(t.id)).status).toBe('awaiting_approval');
      } finally {
        await d.stop();
      }
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('Only tasks made from a spec go into PROGRESS.md', async () => {
  await withReplay(async (root) => {
    expect((await report(root, { specsOnly: true })).spend).toEqual([]);
    expect((await report(root)).spend.length).toBeGreaterThan(0);
  });
}, 120_000);
