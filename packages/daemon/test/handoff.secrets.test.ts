import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHandoff } from '@stint-dev/core';
import { type Adapter, type RunResult, daemonContext, deriveHandoff } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

const SECRET = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/');

test('A tool result containing a credential never appears in the packet or prompt.md', async () => {
  await withFixtureRepo(async (repo) => {
    const leaky: Adapter = {
      ...fakeAdapter('edit'),
      id: 'leaky',
      async run(ctx): Promise<RunResult> {
        await ctx.emit({ type: 'agent.tool_call', payload: { tool: 'bash', args: { command: 'env' }, callId: 'c1' } });
        await ctx.emit({ type: 'agent.tool_result', payload: { tool: 'bash', callId: 'c1', ok: true, summary: `AWS_SECRET_ACCESS_KEY=${SECRET}` } });
        await ctx.emit({ type: 'agent.message', payload: { text: `I printed the environment. AWS_SECRET_ACCESS_KEY=${SECRET} is set.` } });
        return { endedBy: 'completed', cost: { inputTokens: 5, cachedTokens: 0, outputTokens: 5, usd: 0 } };
      },
    };
    const next = fakeAdapter('edit');
    const { app, ws } = await makeApp(repo, [leaky, next]);
    const t = await ws.createTask(newTask);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'leaky', role: 'implementer' });
    for (let i = 0; i < 300 && (await ws.handoffs(t.id).names()).length === 0; i++) await Bun.sleep(50);
    expect((await post(app, `/api/tasks/${t.id}/hand`, { adapter: 'fake' })).status).toBe(202);
    for (let i = 0; i < 300 && next.seen.length === 0; i++) await Bun.sleep(50);
    const dir = await ws.taskDir(t.id);
    const packets = (await ws.handoffs(t.id).names()).map((n) => readFileSync(join(dir, 'handoffs', `${n}.json`), 'utf8'));
    for (const p of [...packets, readFileSync(join(dir, 'handoff.json'), 'utf8'), readFileSync(next.seen[0]?.promptPath as string, 'utf8')]) {
      expect(p).not.toContain(SECRET);
    }
    expect(readFileSync(next.seen[0]?.promptPath as string, 'utf8')).toContain('AWS_SECRET_ACCESS_KEY=[redacted]');
  });
}, 60_000);

// assembled at run time so the secret scan does not read them as real keys
const BEARER = ['eyJhbGciOi', 'JIUzI1NiJ9', 'x7Q2mP9vR4'].join('');
const GITHUB = ['gh', 'p_', 'R8k2Lm4Np6Qr8St0Uv2Wx4Yz6Ab8Cd0Ef2Gh'].join('');

test('A refused command and a decision that hold a credential reach the packet redacted', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const ctx = daemonContext(app);
    const t = await ws.createTask(newTask);
    const events = ws.events(t.id);
    await events.append({ task: t.id, run: 'r1', adapter: 'fake', vendor: 'local', type: 'run.started', payload: { role: 'implementer', model: 'muse-spark-1.3', host: 'local-cli' } });
    await events.append({ task: t.id, run: 'r1', adapter: 'fake', vendor: 'local', type: 'rule.blocked', payload: { action: `curl -H 'Authorization: Bearer ${BEARER}' https://api.example.com`, reason: 'network calls are the human\'s call', by: 'stint-rules' } });
    const d = await ws.decisions(t.id).append({ text: `Clone with ${GITHUB} until the deploy key lands`, by: 'you' });
    await events.append({ task: t.id, run: 'r1', vendor: 'human', type: 'decision.recorded', payload: { id: d.id, text: d.text, by: d.by } });
    await events.append({ task: t.id, run: 'r1', adapter: 'fake', vendor: 'local', type: 'agent.message', payload: { text: 'Stopped before the network call.' } });
    await events.append({ task: t.id, run: 'r1', vendor: 'daemon', type: 'run.finished', payload: { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 }, commit: null } });

    const { handoff } = await deriveHandoff(ctx, t.id, 'r1');
    const text = `${JSON.stringify(handoff)}\n${renderHandoff(handoff)}`;
    expect(text).not.toContain(BEARER);
    expect(text).not.toContain(GITHUB);
    expect(handoff.refusals?.[0]?.action).toBe("curl -H 'Authorization: [redacted]' https://api.example.com");
    expect(handoff.decisions[0]?.text).toBe('Clone with [redacted] until the deploy key lands');
  });
}, 60_000);
