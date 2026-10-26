import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StintEventSchema } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { createApp } from '@stint-dev/daemon';
import { TOKEN, auth, newTask, withFixtureRepo } from '../../../daemon/test/helpers';
import { createStintAgent } from '../src/index';
import { configFor, fakeHost } from './fake';

const recorded = readFileSync(join(import.meta.dir, 'fixtures', 'continue-run.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { body: unknown });

test('Replaying the recorded stream yields validating events with at least one tool call and a run.finished.cost with non-zero tokens', async () => {
  const host = fakeHost(recorded.map((r) => ({ body: r.body })));
  try {
    await withFixtureRepo(async (repo) => {
      const ws = await Workspace.open(repo);
      const app = createApp(ws, [createStintAgent(configFor({ 'meta-api': host.url }), { META_API_KEY: 'replay' })], { token: TOKEN, quiet: true, webDist: null });
      const t = await ws.createTask(newTask);
      await app.request(`/api/tasks/${t.id}/assign`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'stint-agent', role: 'implementer' }) });
      for (let i = 0; i < 600 && !(await ws.events(t.id).read()).some((e) => e.type === 'verification.ran'); i++) await Bun.sleep(50);
      const events = await ws.events(t.id).read();
      for (const e of events) expect(StintEventSchema.safeParse(e).success).toBe(true);
      expect(events.filter((e) => e.type === 'agent.tool_call').length).toBeGreaterThan(0);
      const finished = events.find((e) => e.type === 'run.finished');
      expect(finished?.payload.endedBy).toBe('completed');
      const cost = finished?.payload.cost as { inputTokens: number; outputTokens: number; usd: number };
      expect(cost.inputTokens).toBeGreaterThan(0);
      expect(cost.outputTokens).toBeGreaterThan(0);
      expect(host.seen.length).toBe(recorded.length);
    });
  } finally {
    host.stop();
  }
}, 120_000);
