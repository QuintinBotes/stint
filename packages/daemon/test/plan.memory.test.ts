import { expect, test } from 'bun:test';
import { namedFiles, planTask } from '../src/routes/models';
import { daemonContext } from '../src/app';
import { makeApp, withFixtureRepo } from './helpers';
import { plan, planner, writeConfig } from './plan.fixtures';

test('namedFiles reads context files and the paths a goal and its acceptance mention', () => {
  expect(namedFiles({ goal: 'Wire the limiter into src/routes/webhooks.ts and read limits in `src/config.ts`.', acceptance: ['test/webhooks.test.ts passes', 'Version 1.2 stays'] }, { files: [{ path: 'src/app.ts' }] }).sort()).toEqual(['src/app.ts', 'src/config.ts', 'src/routes/webhooks.ts', 'test/webhooks.test.ts']);
});

test('The planner prompt contains the similar task and the constraining decision from the graph', async () => {
  const models = planner([plan({ similarTasks: ['T-0001', 'T-0999'] })]);
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, models.url);
      const { ws, app } = await makeApp(repo);
      // an earlier task on the same file, with a decision that still holds
      const before = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429 when a tenant is over the limit.', acceptance: ['429 with Retry-After'], testCommand: 'true', tags: ['limits'] });
      await ws.events(before.id).append({ task: before.id, run: 'r1', adapter: 'muse-code', vendor: 'meta', type: 'run.started', payload: { role: 'implementer' } });
      await ws.events(before.id).append({ task: before.id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/lib/limiter.ts', added: 20, removed: 0 } });
      const d = await ws.decisions(before.id).append({ text: 'Limits come from loadConfig(), never literals', by: 'you' });
      await ws.events(before.id).append({ task: before.id, vendor: 'human', type: 'decision.recorded', payload: { id: d.id, text: d.text, by: 'you' }, links: [{ kind: 'decision', ref: d.id }] });

      const t = await ws.createTask({ title: 'Rate-limit the admin API', goal: 'Answer 429 on the admin API with the limiter in src/lib/limiter.ts.', acceptance: ['429 on the admin API'], testCommand: 'true', tags: ['limits'] });
      const written = await planTask(daemonContext(app), t.id);

      const prompt = models.prompts[0] as string;
      const similar = prompt.slice(prompt.indexOf('## Similar tasks'), prompt.indexOf('## Constraints'));
      expect(similar).toContain(`${before.id} Rate-limit incoming webhooks`);
      const constraints = prompt.slice(prompt.indexOf('## Constraints'), prompt.indexOf('## Context'));
      expect(constraints).toContain(`decision ${d.id} (${before.id}, on src/lib/limiter.ts): Limits come from loadConfig(), never literals`);
      // recorded in the plan: the similar ids it was shown (an invented one is dropped) and the constraints
      expect(written.similarTasks).toEqual([before.id]);
      expect(written.constraints).toEqual([{ kind: 'decision', id: d.id, task: before.id, text: 'Limits come from loadConfig(), never literals', files: ['src/lib/limiter.ts'] }]);
    });
  } finally {
    models.stop();
  }
}, 60_000);
