import { existsSync } from 'node:fs';
import { runsFromEvents } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { worktreePath } from '../worktree';

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
    const wt = await currentWorktree(ctx, id, body.run);
    return c.json(await ctx.verifier.verify(task, wt.run, wt.path));
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
