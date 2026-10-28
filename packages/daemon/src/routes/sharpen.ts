import { GOAL_ID, TaskProofSchema } from '@stint-dev/core';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { settleGoal } from '../goals';
import { answerSharpen, setProofs, sharpen, sharpenStateOf, takeRecommendations } from '../sharpen';

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

/**
 * Sharpen a task or a goal before work starts (R-064): the same routes under `/api/tasks/:id` and `/api/goals/:id`.
 * Every POST needs the daemon token, like every change. A goal that becomes ready says so after each change.
 */
export function sharpenRoutes(app: Hono, ctx: DaemonContext): void {
  for (const base of ['tasks', 'goals'] as const) {
    const at = `/api/${base}/:id`;
    // a goal id under /api/tasks, or a task id under /api/goals, names nothing there
    const own = (c: Context) => {
      const id = c.req.param('id') as string;
      if (GOAL_ID.test(id) !== (base === 'goals')) throw new DaemonError('not_found', `no ${base === 'goals' ? 'goal' : 'task'} ${id}`);
      return id;
    };
    const settled = async <T>(id: string, value: T) => {
      if (base === 'goals') await settleGoal(ctx, id);
      return value;
    };

    app.post(`${at}/sharpen`, async (c) => c.json(await sharpen(ctx, own(c))));
    app.get(`${at}/sharpen`, async (c) => c.json(await sharpenStateOf(ctx, own(c))));
    app.post(`${at}/sharpen/answer`, async (c) => {
      const id = own(c);
      const body = AnswerBody.parse(await c.req.json());
      return c.json({ decision: await settled(id, await answerSharpen(ctx, id, body, 'you')) });
    });
    app.post(`${at}/sharpen/recommended`, async (c) => {
      const id = own(c);
      return c.json({ decisions: await settled(id, await takeRecommendations(ctx, id, 'you')) });
    });
    // the proof each criterion is judged by; a task's outcome record reads them from task.json
    app.post(`${at}/proofs`, async (c) => {
      const id = own(c);
      const { proofs } = ProofsBody.parse(await c.req.json());
      return c.json({ proofs: await settled(id, await setProofs(ctx, id, proofs)) });
    });
  }
}
