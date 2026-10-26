import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDef } from '@stint-dev/core';
import { daemonContext } from '../../../daemon/src/app';
import { makeApp, newTask, post, withFixtureRepo } from '../../../daemon/test/helpers';
import { acpAgent, endedByForStopReason, resolveInsideWorktree } from '../src/index';

const FAKE = join(import.meta.dir, 'fixtures', 'fake-agent.ts');
const def: AgentDef = { command: ['bun', FAKE], prompt: 'stdin', roles: ['implementer'], vendor: 'other', enabled: true, harness: 'acp' };

afterEach(() => {
  delete process.env.FAKE_ACP_MODE;
});

type Made = Awaited<ReturnType<typeof makeApp>>;
async function until(made: Made, id: string, done: (types: string[]) => boolean, ms = 30_000) {
  for (let i = 0; i < ms / 50; i++) {
    const events = await made.ws.events(id).read();
    if (done(events.map((e) => e.type))) return events;
    await Bun.sleep(50);
  }
  return made.ws.events(id).read();
}

test('stop reasons map to how the run ended, and paths are held to the worktree', () => {
  expect(endedByForStopReason('end_turn', false)).toBe('completed');
  expect(endedByForStopReason('max_turn_requests', false)).toBe('capped');
  expect(endedByForStopReason('refusal', false)).toBe('failed');
  expect(endedByForStopReason('end_turn', true)).toBe('killed');
  const wt = join(import.meta.dir, 'fixtures');
  expect(resolveInsideWorktree(wt, 'fake-agent.ts')).toMatchObject({ rel: 'fake-agent.ts' });
  expect(resolveInsideWorktree(wt, '../acp.test.ts')).toEqual({ reason: '../acp.test.ts is outside the worktree' });
  expect(resolveInsideWorktree(wt, '.git/config')).toEqual({ reason: 'the .git folder belongs to Stint' });
  expect(resolveInsideWorktree(wt, '.env')).toEqual({ reason: '.env is a credential file' });
});

test('A fake ACP agent that reads, writes, runs a terminal command and asks permission produces the mapped events, a worktree write, a queue row, and finishes after the permission is granted', async () => {
  await withFixtureRepo(async (repo) => {
    const made = await makeApp(repo, [acpAgent('fake-acp', def)]);
    const t = await made.ws.createTask({ ...newTask, testCommand: 'true' });
    expect((await post(made.app, `/api/tasks/${t.id}/assign`, { adapter: 'fake-acp', role: 'implementer' })).status).toBe(202);

    // the agent waits on a person: one queue row, with the agent's own choices
    const asked = await until(made, t.id, (ty) => ty.includes('permission.requested'));
    const request = asked.find((e) => e.type === 'permission.requested');
    expect(request?.payload).toMatchObject({ tool: 'execute', title: 'Run the test suite' });
    const queue = (await (await made.app.request('/api/permissions')).json()) as Array<{ task: string; requestId: string; options: Array<{ optionId: string; kind: string }> }>;
    expect(queue).toHaveLength(1);
    expect(queue[0]?.options.map((o) => o.kind)).toEqual(['allow_once', 'allow_always', 'reject_once']);
    // an option the agent did not offer is refused
    expect((await post(made.app, `/api/tasks/${t.id}/runs/r1/permission`, { requestId: queue[0]?.requestId, optionId: 'yes' })).status).toBe(400);
    expect((await post(made.app, `/api/tasks/${t.id}/runs/r1/permission`, { requestId: queue[0]?.requestId, optionId: 'allow' })).status).toBe(200);

    const events = await until(made, t.id, (ty) => ty.includes('run.finished'));
    expect(events.find((e) => e.type === 'run.finished')?.payload.endedBy).toBe('completed');
    expect(events.find((e) => e.type === 'permission.decided')?.payload).toMatchObject({ optionId: 'allow' });
    const messages = events.filter((e) => e.type === 'agent.message').map((e) => String(e.payload.text)).join(' ');
    expect(messages).toContain('Read 3 lines.');
    expect(messages).toContain('The terminal said: hi.');
    expect(messages).toContain('Allowed (allow).');
    const calls = events.filter((e) => e.type === 'agent.tool_call').map((e) => [e.payload.tool, (e.payload.args as { path?: string }).path]);
    expect(calls).toContainEqual(['edit', 'src/lib/acp.ts']);
    expect(calls).toContainEqual(['write_file', 'src/lib/acp.ts']);
    expect(events.some((e) => e.type === 'agent.tool_result' && e.payload.callId === 't1' && e.payload.ok === true)).toBe(true);
    // the write is the worktree's, and the daemon committed it to the task branch
    const show = Bun.spawnSync(['git', '-C', repo, 'show', `${t.branch}:src/lib/acp.ts`], { stdout: 'pipe' });
    expect(show.stdout.toString()).toBe('export const FROM_ACP = true;\n');
    expect((await (await made.app.request('/api/permissions')).json()) as unknown[]).toEqual([]);
  });
}, 60_000);

test('A write outside the worktree is refused and recorded', async () => {
  process.env.FAKE_ACP_MODE = 'outside';
  await withFixtureRepo(async (repo) => {
    const made = await makeApp(repo, [acpAgent('fake-acp', def)]);
    const t = await made.ws.createTask({ ...newTask, testCommand: 'true' });
    await post(made.app, `/api/tasks/${t.id}/assign`, { adapter: 'fake-acp', role: 'implementer' });
    const events = await until(made, t.id, (ty) => ty.includes('run.finished'));
    const blocked = events.find((e) => e.type === 'rule.blocked');
    expect(blocked?.payload).toMatchObject({ by: 'stint-acp', action: 'fs/write_text_file ../outside.txt' });
    expect(String(blocked?.payload.reason)).toContain('outside the worktree');
    expect(events.map((e) => String(e.payload.text ?? '')).join(' ')).toContain('The write was refused');
    expect(existsSync(join(repo, '.stint', 'worktrees', 'outside.txt'))).toBe(false);
  });
}, 60_000);

test('A stop cancels a waiting permission, records it, and ends the run as killed', async () => {
  process.env.FAKE_ACP_MODE = 'full';
  await withFixtureRepo(async (repo) => {
    const made = await makeApp(repo, [acpAgent('fake-acp', def)]);
    const t = await made.ws.createTask({ ...newTask, testCommand: 'true' });
    await post(made.app, `/api/tasks/${t.id}/assign`, { adapter: 'fake-acp', role: 'implementer' });
    await until(made, t.id, (ty) => ty.includes('permission.requested'));
    expect((await post(made.app, `/api/tasks/${t.id}/runs/r1/stop`, {})).status).toBe(202);
    const events = await until(made, t.id, (ty) => ty.includes('run.finished'));
    expect(events.find((e) => e.type === 'permission.decided')?.payload).toMatchObject({ optionId: null, cancelled: true });
    expect(events.find((e) => e.type === 'run.finished')?.payload.endedBy).toBe('killed');
    expect(daemonContext(made.app).runs.get(t.id)).toBeUndefined();
  });
}, 60_000);
