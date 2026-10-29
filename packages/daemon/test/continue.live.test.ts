import { expect, test } from 'bun:test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { museCodeAdapter } from '@stint-dev/adapter-muse-code';
import { createStintAgent } from '@stint-dev/adapter-stint-agent';
import { Workspace } from '@stint-dev/core/node';
import { createApp } from '../src/index';
import { TOKEN, auth, withFixtureRepo } from './helpers';

const live = process.env.STINT_LIVE === '1';
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test.skipIf(!live)('With STINT_LIVE=1: after a killed Muse Code run, stint hand T-0042 stint-agent ends completed, the daemon\'s verify is green, and no file under done was re-created', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const app = createApp(ws, [museCodeAdapter, createStintAgent(ws.config)], { token: TOKEN, quiet: true, webDist: null, snapshotMs: 1000 });
    const t = await ws.createTask({
      id: 'T-0042',
      title: 'Rate-limit incoming webhooks per tenant',
      goal: 'POST /webhooks answers 429 with a Retry-After header when a tenant sends too many webhooks in a window, without affecting other tenants.',
      acceptance: ['A tenant over the limit gets 429 with a Retry-After header', 'Other tenants are not affected', 'The suite stays green'],
      testCommand: 'bun run test',
    });
    expect((await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer', model: 'muse-spark-1.3' })).status).toBe(202);
    // let Muse Code make real progress, then kill it mid-run
    const until = Date.now() + 8 * 60_000;
    while (Date.now() < until && !(await ws.events(t.id).read()).some((e) => e.type === 'file.changed' && String(e.payload.path).startsWith('src/'))) await Bun.sleep(500);
    await Bun.sleep(4000);
    const stopped = await post(app, `/api/tasks/${t.id}/runs/r1/stop`, {});
    expect(stopped.status).toBe(202);
    // the stop answers at run.finished; the packet follows the verification, as handoff.created
    for (let i = 0; i < 1200 && !(await ws.events(t.id).read()).some((e) => e.type === 'handoff.created' && e.run === 'r1'); i++) await Bun.sleep(250);
    const packet = await ws.handoffs(t.id).latest();
    expect(packet?.from.endedBy).toBe('killed');

    const r1Created = new Set((await ws.events(t.id).read()).filter((e) => e.run === 'r1' && e.type === 'agent.tool_result' && e.payload.tool === 'write_file').map((e) => String((e.payload.args as { path?: string }).path)));
    const hand = await post(app, `/api/tasks/${t.id}/hand`, { adapter: 'stint-agent' });
    expect(hand.status).toBe(202);
    const { run } = (await hand.json()) as { run: string };
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline && !(await ws.events(t.id).read()).some((e) => e.type === 'verification.ran' && e.run === run)) await Bun.sleep(1000);

    const events = await ws.events(t.id).read();
    const finished = events.find((e) => e.type === 'run.finished' && e.run === run);
    expect(finished?.payload.endedBy).toBe('completed');
    const v = events.find((e) => e.type === 'verification.ran' && e.run === run);
    expect(v?.payload.status).toBe('green');
    const rewritten = events.filter((e) => e.run === run && e.type === 'agent.tool_call' && e.payload.tool === 'write_file' && r1Created.has(String((e.payload.args as { path?: string }).path)));
    expect(rewritten.map((e) => (e.payload.args as { path: string }).path)).toEqual([]);

    // keep the agent's model responses as the replay twin
    const fixtures = join(import.meta.dir, '..', '..', 'adapters', 'stint-agent', 'test', 'fixtures');
    mkdirSync(fixtures, { recursive: true });
    copyFileSync(await ws.runs(t.id).transcriptPath(run), join(fixtures, 'continue-run.raw.jsonl'));
    process.stderr.write(`live continue: r1 ${JSON.stringify(events.find((e) => e.type === 'run.finished' && e.run === 'r1')?.payload.cost)}; ${run} ${JSON.stringify(finished?.payload.cost)} on ${finished?.payload.host}; verification ${JSON.stringify(v?.payload)}; packet askOfNext: ${packet?.askOfNext}\n`);
  });
}, 25 * 60_000);

test.skipIf(live)('continue.live.test.ts skips without STINT_LIVE=1 (it needs Muse Code and the Meta Model API); its replay twin runs in CI', () => {
  expect(live).toBe(false);
});
