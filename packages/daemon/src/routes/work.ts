import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type Task, type VerificationRecord, runsFromEvents } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { git, gitOk } from '../git';
import { listScenarioFiles, scenariosDir, storeScenario } from '../scenarios';
import { installDependencies, worktreePath } from '../worktree';

/** The worktree to verify: the named run's, else the newest run whose worktree still exists. */
export async function currentWorktree(ctx: DaemonContext, taskId: string, run?: string): Promise<{ run: string; path: string }> {
  if (run) {
    const path = worktreePath(ctx.ws, taskId, run);
    if (!existsSync(path)) throw new DaemonError('not_found', `${taskId} ${run} has no worktree`, 'the worktree is removed after approve');
    return { run, path };
  }
  const runs = runsFromEvents(await ctx.ws.events(taskId).read()).reverse();
  for (const r of runs) {
    const path = worktreePath(ctx.ws, taskId, r.run);
    if (existsSync(path)) return { run: r.run, path };
  }
  throw new DaemonError('not_found', `${taskId} has no worktree to verify`, 'assign a run first');
}

/** Runs the tests on the task branch head in a checkout of its own, for a task whose worktree is gone (merged, replayed, adopted). */
export async function verifyBranch(ctx: DaemonContext, task: Task, run: string): Promise<VerificationRecord> {
  const head = (await git(ctx.ws.root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).stdout.trim();
  if (!head) throw new DaemonError('not_found', `${task.id} has nothing to verify`, 'a run creates the task branch');
  const path = join(ctx.ws.cacheDir, 'verify', `${task.id}-${Date.now()}`);
  await mkdir(join(ctx.ws.cacheDir, 'verify'), { recursive: true });
  await gitOk(ctx.ws.root, ['worktree', 'add', '-q', '--detach', path, head]);
  try {
    await installDependencies(path);
    return await ctx.verifier.verify(task, run, path);
  } finally {
    // this checkout holds no work, only the branch head and the test run's leftovers, so it is removed even if dirty
    await git(ctx.ws.root, ['worktree', 'remove', '--force', path]);
  }
}

export function workRoutes(app: Hono, ctx: DaemonContext): void {
  app.post('/api/tasks/:id/verify', async (c) => {
    const id = c.req.param('id');
    const task = await ctx.ws.readTask(id);
    const body = (await c.req.json().catch(() => ({}))) as { run?: unknown };
    if (body.run !== undefined && (typeof body.run !== 'string' || !/^r[0-9]+$/.test(body.run))) throw new DaemonError('invalid', `${String(body.run)} is not a run id`, 'runs are r1, r2, ...');
    if (ctx.runs.get(id)) throw new DaemonError('run_active', `${id} has a live run`, 'verification runs when the run ends');
    const wt = await currentWorktree(ctx, id, body.run).catch(() => null);
    if (wt) {
      // what was changed by hand is committed first, so the verified commit is the tree the tests ran on
      if ((await gitOk(wt.path, ['status', '--porcelain'])).trim()) await ctx.worktrees.commit(task, wt.run, wt.path, 'changes made outside a run');
      return c.json(await ctx.verifier.verify(task, wt.run, wt.path));
    }
    const last = runsFromEvents(await ctx.ws.events(id).read()).filter((r) => r.role === 'implementer').at(-1);
    if (!last) throw new DaemonError('not_found', `${id} has nothing to verify`, 'a run creates the task branch');
    return c.json(await verifyBranch(ctx, task, last.run));
  });

  // an agent or a person records a decision; a reversal names what it supersedes and never edits it
  app.post('/api/tasks/:id/decisions', async (c) => {
    const id = c.req.param('id');
    await ctx.ws.readTask(id);
    const body = z
      .strictObject({ text: z.string().min(1).max(200), supersedes: z.string().regex(/^D[0-9]+$/).optional(), by: z.string().min(1).max(80).optional() })
      .parse(await c.req.json());
    const d = await ctx.ws.decisions(id).append({ text: body.text, by: body.by ?? 'you', ...(body.supersedes ? { supersedes: body.supersedes } : {}) });
    await ctx.ws.events(id).append({ task: id, vendor: body.by && body.by !== 'you' ? 'daemon' : 'human', type: 'decision.recorded', payload: { id: d.id, text: d.text, by: d.by, ...(d.supersedes ? { supersedes: d.supersedes } : {}) }, links: [{ kind: 'decision', ref: d.id }] });
    return c.json(d, 201);
  });

  app.get('/api/tasks/:id/decisions', async (c) => {
    const id = c.req.param('id');
    await ctx.ws.readTask(id);
    return c.json(await ctx.ws.decisions(id).validAt());
  });

  // held-out scenarios: stored by the daemon outside every worktree; the list names files, never their source
  app.post('/api/tasks/:id/scenarios', async (c) => {
    const id = c.req.param('id');
    const body = z
      .strictObject({ name: z.string().min(1).max(300), content: z.string().max(200_000) })
      .parse(await c.req.json());
    const name = await storeScenario(ctx.ws, id, body.name, body.content);
    return c.json({ name }, 201);
  });

  app.get('/api/tasks/:id/scenarios', async (c) => {
    const id = c.req.param('id');
    await ctx.ws.readTask(id);
    return c.json({ names: await listScenarioFiles(scenariosDir(ctx.ws, id)) });
  });

  app.get('/api/tasks/:id/verification', async (c) => {
    const id = c.req.param('id');
    await ctx.ws.readTask(id);
    return c.json(await ctx.ws.verification(id).list());
  });

  app.get('/api/tasks/:id/verification/:run/output', async (c) => {
    const id = c.req.param('id');
    const run = c.req.param('run');
    if (!/^r[0-9]+$/.test(run)) throw new DaemonError('invalid', `bad run ${run}`);
    const file = join(await ctx.ws.taskDir(id), 'verification', `${run}.out.txt`);
    if (!existsSync(file)) throw new DaemonError('not_found', `${id} kept no test output for ${run}`, 'replayed runs carry their counts, not their output');
    return c.text(await Bun.file(file).text());
  });

  // a visual check's screenshot, its marked copy and its clip (R-068)
  app.get('/api/tasks/:id/verification/:run/visual/:file', async (c) => {
    const id = c.req.param('id');
    const run = c.req.param('run');
    const name = c.req.param('file');
    if (!/^r[0-9]+$/.test(run) || !/^visual-[0-9]{1,2}(-marked)?\.(png|webm)$/.test(name)) throw new DaemonError('invalid', `bad visual file ${run}/${name}`);
    const file = Bun.file(join(await ctx.ws.taskDir(id), 'verification', run, name));
    if (!(await file.exists())) throw new DaemonError('not_found', `${id} kept no ${name} for ${run}`);
    return new Response(file, { headers: { 'Content-Type': name.endsWith('.webm') ? 'video/webm' : 'image/png', 'Cache-Control': 'no-cache' } });
  });

  app.get('/api/tasks/:id/handoffs', async (c) => {
    const id = c.req.param('id');
    await ctx.ws.readTask(id);
    return c.json({ names: await ctx.ws.handoffs(id).names() });
  });

  app.get('/api/tasks/:id/handoffs/:name', async (c) => {
    const id = c.req.param('id');
    await ctx.ws.readTask(id);
    const name = c.req.param('name');
    if (!/^h[0-9]+$/.test(name)) throw new DaemonError('invalid', `bad packet name ${name}`);
    const packet = await ctx.ws.handoffs(id).read(name);
    if (!packet) throw new DaemonError('not_found', `${id} has no packet ${name}`);
    return c.json({ name, packet, meta: await ctx.ws.handoffs(id).readMeta(name) });
  });

  app.get('/api/tasks/:id/diff', async (c) => {
    const task = await ctx.ws.readTask(c.req.param('id'));
    const format = c.req.query('format') === 'json' ? 'json' : 'unified';
    // blame=1 attributes each range of lines to the run whose ending commit last wrote it (R-052)
    if (format === 'json' && c.req.query('blame') === '1') {
      const commitToRun = new Map<string, string>();
      for (const e of await ctx.ws.events(task.id).read()) {
        if (e.type === 'run.finished' && e.run && typeof e.payload.commit === 'string') commitToRun.set(e.payload.commit, e.run);
      }
      return c.json(await ctx.worktrees.diffBlame(task, commitToRun));
    }
    const out = await ctx.worktrees.diff(task, format);
    return format === 'json' ? c.json(out) : c.text(out as string);
  });
}
