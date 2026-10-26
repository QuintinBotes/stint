import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitOk } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

describe('assign', () => {
  test('assign with role reviewer for an adapter without that role returns 400 capability_mismatch', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo, [fakeAdapter('edit', ['implementer'])]);
      const t = await ws.createTask(newTask);
      const res = await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'reviewer' });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('capability_mismatch');
      const unknown = await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'nobody', role: 'implementer' });
      expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('adapter_unavailable');
    });
  });

  test('an assigned run writes prompt.md, edits in its worktree, commits, emits run.finished with cost, and the daemon verifies', async () => {
    await withFixtureRepo(async (repo) => {
      const adapter = fakeAdapter('edit');
      const { app, ws } = await makeApp(repo, [adapter]);
      const t = await ws.createTask(newTask);
      const res = await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
      expect(res.status).toBe(202);
      const { run, worktree } = (await res.json()) as { run: string; worktree: string };
      expect(run).toBe('r1');
      for (let i = 0; i < 300 && (await ws.readTask(t.id)).status !== 'reviewing'; i++) await Bun.sleep(50);
      const events = await ws.events(t.id).read();
      const types = events.map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['run.started', 'skill.applied', 'agent.tool_call', 'agent.tool_result', 'agent.message', 'file.changed', 'run.finished', 'verification.ran']));
      const finished = events.find((e) => e.type === 'run.finished');
      expect(finished?.payload).toMatchObject({ endedBy: 'completed', cost: { inputTokens: 100, usd: 0.001 } });
      expect((await ws.verification(t.id).read('r1'))?.passed).toBe(27);
      expect((await gitOk(join(repo, worktree), ['log', '-1', '--format=%s'])).trim()).toBe(`wip(${t.id} r1): completed`);
      const prompt = readFileSync(adapter.seen[0]?.promptPath as string, 'utf8');
      expect(prompt).toContain(`# Stint task ${t.id}`);
      expect(prompt).toContain('review-voice-policy');
      expect(existsSync(join(repo, worktree, 'src/lib/limiter.ts'))).toBe(true);
    });
  }, 60_000);
});
