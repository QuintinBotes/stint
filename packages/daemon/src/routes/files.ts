import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { type NumstatEntry, git } from '../git';
import { currentWorktree } from './work';

const MAX_BYTES = 512 * 1024;

/** Where a task's files are: its live worktree, or else its branch as git has it (read-only). */
async function source(ctx: DaemonContext, id: string): Promise<{ worktree: string | null; ref: string }> {
  const task = await ctx.ws.readTask(id);
  const wt = await currentWorktree(ctx, id).catch(() => null);
  if (wt) return { worktree: wt.path, ref: task.branch };
  const branch = (await git(ctx.ws.root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).code === 0;
  return { worktree: null, ref: branch ? task.branch : task.baseCommit };
}

async function tree(ctx: DaemonContext, id: string): Promise<string[]> {
  const s = await source(ctx, id);
  // tracked and new files in a worktree; the whole tree of the ref otherwise
  const r = s.worktree
    ? await git(s.worktree, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    : await git(ctx.ws.root, ['ls-tree', '-r', '-z', '--name-only', s.ref]);
  return [...new Set(r.stdout.split('\0').filter(Boolean))].sort();
}

/** The person's editor: `editor` from config, else the first of Cursor, VS Code and Zed on PATH, else the OS opener. */
export function editorCommand(configured: string[] | undefined, path: string, line?: number): string[] | null {
  const fill = (argv: string[]) => argv.map((a) => a.replaceAll('{path}', path).replaceAll('{line}', String(line ?? 1)));
  if (configured?.length) return fill(configured);
  for (const [bin, argv] of [
    ['cursor', ['cursor', '-g', '{path}:{line}']],
    ['code', ['code', '-g', '{path}:{line}']],
    ['zed', ['zed', '{path}:{line}']],
  ] as const) {
    if (Bun.which(bin)) return fill([...argv]);
  }
  if (process.platform === 'darwin') return ['open', path];
  if (Bun.which('xdg-open')) return ['xdg-open', path];
  return null;
}

const OpenBody = z.strictObject({ path: z.string().min(1).max(500).optional(), line: z.int().min(1).optional() });

export function fileRoutes(app: Hono, ctx: DaemonContext): void {
  // the files of a task, with the ones its change touched marked (R-024 workspace view)
  app.get('/api/tasks/:id/files', async (c) => {
    const id = c.req.param('id');
    const task = await ctx.ws.readTask(id);
    const s = await source(ctx, id);
    const changed = ((await ctx.worktrees.diff(task, 'json').catch(() => [])) as NumstatEntry[]).map((f) => ({ path: f.path, added: f.added, removed: f.removed }));
    return c.json({ files: await tree(ctx, id), changed, worktree: s.worktree ? relative(ctx.ws.root, s.worktree) : null, ref: s.ref, editable: !!s.worktree });
  });

  app.get('/api/tasks/:id/files/content', async (c) => {
    const id = c.req.param('id');
    const path = c.req.query('path') ?? '';
    // only a path the tree lists is read: no "..", no absolute paths, nothing outside the task
    if (!(await tree(ctx, id)).includes(path)) throw new DaemonError('not_found', `${path} is not a file of ${id}`);
    const s = await source(ctx, id);
    let content: string;
    if (s.worktree) {
      const full = join(s.worktree, path);
      const real = realpathSync(full);
      if (real !== realpathSync(s.worktree) && !real.startsWith(realpathSync(s.worktree) + sep)) throw new DaemonError('invalid', `${path} points outside the worktree`);
      if (statSync(real).size > MAX_BYTES) return c.json({ path, content: null, reason: 'larger than 512 KB; open it in your editor' });
      content = readFileSync(real, 'utf8');
    } else {
      const r = await git(ctx.ws.root, ['show', `${s.ref}:${path}`]);
      if (r.code !== 0) throw new DaemonError('not_found', `${path} is not on ${s.ref}`);
      if (r.stdout.length > MAX_BYTES) return c.json({ path, content: null, reason: 'larger than 512 KB' });
      content = r.stdout;
    }
    if (content.includes('\0')) return c.json({ path, content: null, reason: 'a binary file' });
    return c.json({ path, content });
  });

  // opens the live worktree, or one file of it, in the person's own editor
  app.post('/api/tasks/:id/open', async (c) => {
    const id = c.req.param('id');
    const body = OpenBody.parse(await c.req.json().catch(() => ({})));
    const s = await source(ctx, id);
    if (!s.worktree) throw new DaemonError('not_found', `${id} has no worktree to open`, 'it was merged or not started; the Files tab still shows its branch');
    if (body.path && !(await tree(ctx, id)).includes(body.path)) throw new DaemonError('not_found', `${body.path} is not a file of ${id}`);
    const target = body.path ? join(s.worktree, body.path) : s.worktree;
    if (!existsSync(target)) throw new DaemonError('not_found', `${body.path ?? 'the worktree'} does not exist yet`);
    const argv = editorCommand(ctx.ws.config.editor, target, body.line);
    if (!argv) throw new DaemonError('adapter_unavailable', 'no editor found', 'set "editor" in .stint/config.json, for example ["code", "-g", "{path}:{line}"]');
    const child = Bun.spawn(argv, { cwd: s.worktree, stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
    child.unref();
    return c.json({ opened: target, with: argv[0] });
  });
}
