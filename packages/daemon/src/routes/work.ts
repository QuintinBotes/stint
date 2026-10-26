import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runsFromEvents } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { git, gitOk } from '../git';
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

export function workRoutes(app: Hono, ctx: DaemonContext): void {
  app.post('/api/tasks/:id/verify', async (c) => {
    const id = c.req.param('id');
    const task = await ctx.ws.readTask(id);
    const body = (await c.req.json().catch(() => ({}))) as { run?: string };
    if (ctx.runs.get(id)) throw new DaemonError('run_active', `${id} has a live run`, 'verification runs when the run ends');
    const wt = await currentWorktree(ctx, id, body.run).catch(() => null);
    if (wt) return c.json(await ctx.verifier.verify(task, wt.run, wt.path));
    // no worktree (merged, or replayed): check the task branch out on its own and run the tests there
    const head = (await git(ctx.ws.root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).stdout.trim();
    const last = runsFromEvents(await ctx.ws.events(id).read()).filter((r) => r.role === 'implementer').at(-1);
    if (!head || !last) throw new DaemonError('not_found', `${id} has nothing to verify`, 'a run creates the task branch');
    const path = join(ctx.ws.cacheDir, 'verify', `${id}-${Date.now()}`);
    await mkdir(join(ctx.ws.cacheDir, 'verify'), { recursive: true });
    await gitOk(ctx.ws.root, ['worktree', 'add', '-q', '--detach', path, head]);
    try {
      await installDependencies(path);
      return c.json(await ctx.verifier.verify(task, last.run, path));
    } finally {
      // this checkout holds no work, only the branch head and the test run's leftovers, so it is removed even if dirty
      await git(ctx.ws.root, ['worktree', 'remove', '--force', path]);
    }
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
    const out = await ctx.worktrees.diff(task, format);
    return format === 'json' ? c.json(out) : c.text(out as string);
  });
}
