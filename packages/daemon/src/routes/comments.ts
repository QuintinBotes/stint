import { join } from 'node:path';
import { KeyedQueue, readJsonIfExists, writeJsonAtomic } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { ulid } from 'ulid';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';

export type LineComment = { id: string; file: string; line: number; text: string; at: string; handedTo?: string };

// one writer at a time per task, so a post and a hand never overwrite each other
const queue = new KeyedQueue();

async function commentsPath(ctx: DaemonContext, taskId: string): Promise<string> {
  return join(await ctx.ws.taskDir(taskId), 'comments.json');
}

/** Every line comment on a task, oldest first; an absent file reads as none. */
export async function readComments(ctx: DaemonContext, taskId: string): Promise<LineComment[]> {
  const stored = await readJsonIfExists<unknown>(await commentsPath(ctx, taskId));
  return Array.isArray(stored) ? (stored as LineComment[]) : [];
}

async function writeComments(ctx: DaemonContext, taskId: string, comments: LineComment[]): Promise<void> {
  await writeJsonAtomic(await commentsPath(ctx, taskId), comments);
}

/** The comments no hand has carried yet, as the suffix the next ask gets; null when there are none. */
export function pendingCommentSuffix(comments: LineComment[]): string | null {
  const pending = comments.filter((c) => !c.handedTo);
  if (pending.length === 0) return null;
  const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
  return `Review comments: ${pending.map((c) => `${c.file}:${c.line} ${oneLine(c.text)}`).join('; ')}`;
}

/** Marks comments as handed to a run, so a later hand does not repeat them. */
export async function markCommentsHanded(ctx: DaemonContext, taskId: string, run: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await queue.run(taskId, async () => {
    const comments = await readComments(ctx, taskId);
    await writeComments(
      ctx,
      taskId,
      comments.map((c) => (ids.includes(c.id) && !c.handedTo ? { ...c, handedTo: run } : c)),
    );
  });
}

function parseComment(body: unknown): { file: string; line: number; text: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const file = b.file;
  if (typeof file !== 'string' || file.length === 0) {
    throw new DaemonError('invalid', 'a comment needs the file it is on', 'send file as a path relative to the repository root');
  }
  const segments = file.split(/[\\/]/);
  if (file.startsWith('/') || segments.some((s) => s === '..' || s === '')) {
    throw new DaemonError('invalid', `the comment file must be a relative path inside the repository, not ${file}`, 'use a path like src/lib/limiter.ts, with no .. segment');
  }
  if (typeof b.line !== 'number' || !Number.isInteger(b.line) || b.line < 1) {
    throw new DaemonError('invalid', 'a comment needs the line it is on', 'send line as a positive whole number');
  }
  if (typeof b.text !== 'string' || b.text.length < 1 || b.text.length > 2000) {
    throw new DaemonError('invalid', 'a comment needs text of 1 to 2000 characters', 'say what the next agent should change on that line');
  }
  return { file, line: b.line, text: b.text };
}

export function commentRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/tasks/:id/comments', async (c) => {
    const id = c.req.param('id');
    await ctx.ws.readTask(id);
    return c.json(await readComments(ctx, id));
  });

  app.post('/api/tasks/:id/comments', async (c) => {
    const id = c.req.param('id');
    await ctx.ws.readTask(id);
    const input = parseComment(await c.req.json().catch(() => null));
    const comments = await queue.run(id, async () => {
      const next = [...(await readComments(ctx, id)), { id: ulid(), ...input, at: new Date().toISOString() }];
      await writeComments(ctx, id, next);
      return next;
    });
    return c.json(comments, 201);
  });
}
