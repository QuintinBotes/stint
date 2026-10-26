import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { approveSkill, keepSkill, listSkills, rejectSkill, retireSkill, updateSkillStatuses } from '../skills';

const ApproveBody = z.strictObject({ by: z.string().min(1).max(80).optional() });
const RejectBody = z.strictObject({ reason: z.string().min(1).max(400) });
const EmptyBody = z.strictObject({});

export function skillRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/skills', async (c) => c.json(await listSkills(ctx.ws)));

  app.post('/api/skills/:id/approve', async (c) => {
    const body = ApproveBody.parse(await c.req.json().catch(() => ({})));
    const approved = await approveSkill(ctx.ws, c.req.param('id'), body.by ?? 'you');
    await updateSkillStatuses(ctx);
    return c.json(approved);
  });

  app.post('/api/skills/:id/reject', async (c) => {
    const { reason } = RejectBody.parse(await c.req.json());
    const rejected = await rejectSkill(ctx.ws, c.req.param('id'), reason);
    await updateSkillStatuses(ctx);
    return c.json(rejected);
  });

  app.post('/api/skills/:id/retire', async (c) => {
    EmptyBody.parse(await c.req.json().catch(() => ({})));
    return c.json(await retireSkill(ctx.ws, c.req.param('id')));
  });

  app.post('/api/skills/:id/keep', async (c) => {
    EmptyBody.parse(await c.req.json().catch(() => ({})));
    return c.json(await keepSkill(ctx.ws, c.req.param('id')));
  });
}
