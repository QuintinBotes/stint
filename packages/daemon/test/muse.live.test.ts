import { expect, test } from 'bun:test';
import { Workspace } from '@stint-dev/core/node';
import { museCodeAdapter } from '@stint-dev/adapter-muse-code';
import { createApp } from '../src/index';
import { TOKEN, auth, withFixtureRepo } from './helpers';

const live = process.env.STINT_LIVE === '1';

test.skipIf(!live)('With STINT_LIVE=1 and a key: assigning T-0042 on the fixture copy edits files, run.finished.endedBy is completed or capped, and the daemon\'s verify runs', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const app = createApp(ws, [museCodeAdapter], { token: TOKEN, quiet: true, webDist: null });
    const t = await ws.createTask({
      id: 'T-0042',
      title: 'Rate-limit incoming webhooks per tenant',
      goal: 'POST /webhooks answers 429 with a Retry-After header when a tenant sends too many webhooks in a window, without affecting other tenants.',
      acceptance: ['A tenant over the limit gets 429 with a Retry-After header', 'Other tenants are not affected', 'The suite stays green'],
      testCommand: 'bun run test',
    });
    const res = await app.request(`/api/tasks/${t.id}/assign`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'muse-code', role: 'implementer', model: 'muse-spark-1.3' }) });
    expect(res.status).toBe(202);
    const deadline = Date.now() + 14 * 60_000;
    while (Date.now() < deadline && !(await ws.events(t.id).read()).some((e) => e.type === 'verification.ran')) await Bun.sleep(1000);
    const events = await ws.events(t.id).read();
    const finished = events.find((e) => e.type === 'run.finished');
    expect(['completed', 'capped']).toContain(finished?.payload.endedBy as string);
    expect(events.some((e) => e.type === 'file.changed')).toBe(true);
    expect(events.some((e) => e.type === 'verification.ran')).toBe(true);
    process.stderr.write(`live muse run: ${events.length} events, ${JSON.stringify(finished?.payload.cost)}, verification ${JSON.stringify(events.find((e) => e.type === 'verification.ran')?.payload)}\n`);
  });
}, 15 * 60_000);

test.skipIf(live)('muse.live.test.ts skips without STINT_LIVE=1 (it needs Muse Code and the Meta Model API)', () => {
  expect(live).toBe(false);
});
