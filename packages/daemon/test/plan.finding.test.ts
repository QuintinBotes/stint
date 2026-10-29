import { expect, test } from 'bun:test';
import { daemonContext } from '../src/app';
import { planTask } from '../src/routes/models';
import { makeApp, withFixtureRepo } from './helpers';
import { plan, planner, writeConfig } from './plan.fixtures';

test('R-036 Req 1: an open review finding on a file the task names reaches the planner prompt and the plan as a finding constraint', async () => {
  const models = planner([plan()]);
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, models.url);
      const { ws, app } = await makeApp(repo);
      // an earlier task whose review left a finding on the limiter that nothing resolved
      const before = await ws.createTask({ title: 'Count webhooks per tenant', goal: 'Each tenant has its own counter.', acceptance: ['separate counters'], testCommand: 'true' });
      const finding = { id: 'F2', severity: 'major', file: 'src/lib/limiter.ts', line: 14, text: 'The window resets when the daemon restarts.' };
      await ws.events(before.id).append({ task: before.id, run: 'r2', vendor: 'meta', type: 'review.recorded', payload: { verdict: 'request_changes', findings: 1, review: { version: 'stint.review/1', verdict: 'request_changes', findings: [finding], blockers: [] } } });

      const t = await ws.createTask({ title: 'Rate-limit the admin API', goal: 'Answer 429 on the admin API with the limiter in src/lib/limiter.ts.', acceptance: ['429 on the admin API'], testCommand: 'true' });
      const written = await planTask(daemonContext(app), t.id);

      const prompt = models.prompts[0] as string;
      const constraints = prompt.slice(prompt.indexOf('## Constraints'), prompt.indexOf('## Context'));
      expect(constraints).toContain(`- finding F2 (${before.id}, on src/lib/limiter.ts): The window resets when the daemon restarts.`);
      expect(written.constraints).toEqual([{ kind: 'finding', id: 'F2', task: before.id, text: 'The window resets when the daemon restarts.', files: ['src/lib/limiter.ts'] }]);
    });
  } finally {
    models.stop();
  }
}, 60_000);
