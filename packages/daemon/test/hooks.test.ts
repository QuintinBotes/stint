import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startDaemon } from '../src/index';
import { fakeAdapter, newTask, withFixtureRepo } from './helpers';

const stint = join(import.meta.dir, '..', '..', 'cli', 'bin', 'stint');

// async: the daemon answers from this same process, so a sync spawn would block it
async function hook(event: string, env: Record<string, string | undefined>, stdin?: string) {
  const p = Bun.spawn(['bun', stint, 'hook', event], { env, stdin: stdin ? Buffer.from(stdin) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stderr] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  return { exitCode, stderr };
}

const sleeper = fakeAdapter('sleep');

test('The hook posts its payload by hand and the daemon drafts a packet with reason precompact; PreToolUse names the in-flight step a kill reports', async () => {
  await withFixtureRepo(async (repo) => {
    const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...sleeper, id: 'muse-code', run: async (ctx) => ({ ...(await sleeper.run(ctx)), inFlight: 'write_file' }) }] });
    try {
      const t = await d.ws.createTask(newTask);
      const res = await fetch(`${d.url}/api/tasks/${t.id}/assign`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'muse-code', role: 'implementer' }) });
      const { run, worktree } = (await res.json()) as { run: string; worktree: string };
      const env = { ...process.env, STINT_TASK: t.id, STINT_RUN: run, STINT_WORKTREE: join(repo, worktree) };

      const pre = await hook('PreCompact', env);
      expect(pre.exitCode).toBe(0);
      expect(pre.stderr).toBe('');
      const created = (await d.ws.events(t.id).read()).find((e) => e.type === 'handoff.created');
      expect(created?.payload.reason).toBe('precompact');

      const tool = await hook('PreToolUse', env, JSON.stringify({ tool_name: 'write_file', tool_input: { path: 'test/ratelimit.test.ts' } }));
      expect(tool.exitCode).toBe(0);
      expect(tool.stderr).toBe('');
      await fetch(`${d.url}/api/tasks/${t.id}/runs/${run}/stop`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}` } });
      const finished = (await d.ws.events(t.id).read()).find((e) => e.type === 'run.finished');
      expect(finished?.payload.inFlight).toBe('write_file test/ratelimit.test.ts');
      const packet = await d.ws.handoffs(t.id).latest();
      expect(packet?.leftOut).toContain('In-flight step unknown: write_file test/ratelimit.test.ts');
    } finally {
      await d.stop();
    }
  });
}, 60_000);

const live = process.env.STINT_LIVE === '1';
/** The Stint plugin installed and approved in this person's Muse config; installing it is the person's step (ADR-0005). */
const pluginInstalled = (() => {
  if (!Bun.which('muse')) return false;
  const out = Bun.spawnSync(['muse', 'plugins', 'list'], { stdout: 'pipe', stderr: 'pipe' }).stdout.toString();
  return /\bstint\b/.test(out);
})();

// R-014 Acceptance 2's live case (R-057): Muse compacts at once, and its PreCompact hook reaches the daemon
test.skipIf(!live || !pluginInstalled)('With STINT_LIVE=1 and the Stint plugin installed, a forced compaction in a real Muse Code run drafts a packet with reason precompact', async () => {
  await withFixtureRepo(async (repo) => {
    const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...sleeper, id: 'muse-code' }] });
    try {
      const t = await d.ws.createTask(newTask);
      const res = await fetch(`${d.url}/api/tasks/${t.id}/assign`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'muse-code', role: 'implementer' }) });
      const { run, worktree } = (await res.json()) as { run: string; worktree: string };
      const env = { ...process.env, STINT_TASK: t.id, STINT_RUN: run, STINT_WORKTREE: join(repo, worktree) };
      const p = Bun.spawn(['muse', 'exec', '--json', '--model', 'muse-spark-1.3', '--max-model-steps', '6', '--context-compaction-hard-threshold', '0.02', '--prompt', 'Read src/app.ts and src/config.ts and summarise them.'], { cwd: join(repo, worktree), env, stdout: 'ignore', stderr: 'ignore' });
      await p.exited;
      const created = (await d.ws.events(t.id).read()).find((e) => e.type === 'handoff.created' && e.payload.reason === 'precompact');
      expect(created).toBeDefined();
    } finally {
      await d.stop();
    }
  });
}, 300_000);

test.skipIf(live && pluginInstalled)('the live compaction case skips without STINT_LIVE=1 and the Stint plugin installed (muse plugins list); the hand-posted hook above is its replay twin', () => {
  expect(live && pluginInstalled).toBe(false);
});
