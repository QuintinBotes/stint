import { TaskProofSchema, sharpenState } from '@stint-dev/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { answerSharpen, sharpen, takeRecommendations } from '../sharpen';

const AnswerBody = z
  .strictObject({
    question: z.string().regex(/^Q[0-9]+$/).optional(),
    assumption: z.string().regex(/^A[0-9]+$/).optional(),
    option: z.string().min(1).max(120).optional(),
    text: z.string().min(1).max(1000).optional(),
  })
  .refine((b) => !b.question !== !b.assumption, { message: 'name one question or one assumption', path: ['question'] })
  .refine((b) => b.option !== undefined || b.text !== undefined, { message: 'give an option or your own words', path: ['option'] });

const ProofsBody = z.strictObject({ proofs: z.array(TaskProofSchema).max(12) });

/** Sharpen a task before work starts (R-064). Every POST needs the daemon token, like every change. */
export function sharpenRoutes(app: Hono, ctx: DaemonContext): void {
  app.post('/api/tasks/:id/sharpen', async (c) => c.json(await sharpen(ctx, c.req.param('id'))));

  app.get('/api/tasks/:id/sharpen', async (c) => {
    const id = c.req.param('id');
    const task = await ctx.ws.readTask(id);
    return c.json(sharpenState(await ctx.ws.events(id).read(), task));
  });

  app.post('/api/tasks/:id/sharpen/answer', async (c) => {
    const body = AnswerBody.parse(await c.req.json());
    return c.json({ decision: await answerSharpen(ctx, c.req.param('id'), body, 'you') });
  });

  app.post('/api/tasks/:id/sharpen/recommended', async (c) => c.json({ decisions: await takeRecommendations(ctx, c.req.param('id'), 'you') }));

  // the proof each criterion is judged by; the outcome record reads them from task.json
  app.post('/api/tasks/:id/proofs', async (c) => {
    const id = c.req.param('id');
    const { proofs } = ProofsBody.parse(await c.req.json());
    const task = await ctx.ws.readTask(id);
    const outside = proofs.find((p) => p.criterion > task.acceptance.length);
    if (outside) throw new DaemonError('invalid', `${id} has no criterion ${outside.criterion}`, `it has ${task.acceptance.length}`);
    if (new Set(proofs.map((p) => p.criterion)).size !== proofs.length) throw new DaemonError('invalid', 'one proof per criterion');
    const sorted = [...proofs].sort((a, b) => a.criterion - b.criterion);
    await ctx.ws.writeTask(id, { proofs: sorted });
    await ctx.ws.events(id).append({ task: id, vendor: 'human', type: 'proofs.set', payload: { proofs: sorted, from: task.proofs ?? [] } });
    return c.json({ proofs: sorted });
  });
}
