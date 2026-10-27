import { expect, test } from 'bun:test';
import { countTokens, renderHandoff } from '@stint-dev/core';
import { daemonContext, deriveHandoff } from '../src/index';
import { makeApp, newTask, withFixtureRepo } from './helpers';

const cost = { inputTokens: 10, cachedTokens: 0, outputTokens: 2, usd: 0 };
const FILE = 'src/lib/limiter.ts';

test("A packet for a task whose files another task's decision constrains carries that decision", async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const ctx = daemonContext(app);
    const first = await ws.createTask({ ...newTask, title: 'First limiter task' });
    const second = await ws.createTask({ ...newTask, title: 'Second limiter task' });

    const runOn = async (id: string) => {
      const events = ws.events(id);
      await events.append({ task: id, run: 'r1', adapter: 'fake', vendor: 'local', type: 'run.started', payload: { role: 'implementer', model: 'muse-spark-1.3', host: 'local-cli' } });
      await events.append({ task: id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: FILE, added: 5, removed: 0, run: 'r1' } });
      await events.append({ task: id, run: 'r1', adapter: 'fake', vendor: 'local', type: 'agent.message', payload: { text: 'Worked on the limiter.' } });
      await events.append({ task: id, run: 'r1', vendor: 'daemon', type: 'run.finished', payload: { endedBy: 'completed', cost, commit: null } });
    };

    await runOn(first.id);
    const foreign = await ws.decisions(first.id).append({ text: 'Limiter config comes from the environment, never a file', by: 'you' });
    await ws.events(first.id).append({ task: first.id, run: 'r1', vendor: 'human', type: 'decision.recorded', payload: { id: foreign.id, text: foreign.text, by: foreign.by } });

    await Bun.sleep(10);
    const own = await ws.decisions(second.id).append({ text: 'Count requests per tenant, not per source IP', by: 'you' });
    await runOn(second.id);
    await ws.events(second.id).append({ task: second.id, run: 'r1', vendor: 'human', type: 'decision.recorded', payload: { id: own.id, text: own.text, by: own.by } });

    const { handoff } = await deriveHandoff(ctx, second.id, 'r1');
    // this task's own decision first, the constraining one from the other task after it
    expect(handoff.decisions.map((d) => d.text)).toEqual(['Count requests per tenant, not per source IP', 'Limiter config comes from the environment, never a file']);
    expect(renderHandoff(handoff)).toContain('Limiter config comes from the environment, never a file');
    expect(countTokens(renderHandoff(handoff))).toBeLessThanOrEqual(600);
  });
}, 60_000);
