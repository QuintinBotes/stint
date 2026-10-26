import type { Hono } from 'hono';
import { z } from 'zod';
import { join } from 'node:path';
import { writeJsonAtomic } from '@stint-dev/core/node';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { approveSkill, keepSkill, listSkills, rejectSkill, retireSkill, updateSkillStatuses } from '../skills';

const ApproveBody = z.strictObject({ by: z.string().min(1).max(80).optional() });
const RejectBody = z.strictObject({ reason: z.string().min(1).max(400) });
const EmptyBody = z.strictObject({});
const Side = z.looseObject({ runs: z.number(), findings: z.number(), passed: z.number(), failed: z.number() });
const EvalBody = z.looseObject({ version: z.literal('stint.skillEval/1'), id: z.string(), replay: z.boolean(), tasks: z.array(z.string()), with: Side, without: Side, card: z.string().max(400), evidence: z.array(z.string()).default([]) });

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

  // a finished eval (R-031) is written by the daemon, the one writer of .stint: the file and one skill.evaluated
  app.post('/api/skills/:id/evaluated', async (c) => {
    const id = c.req.param('id');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new DaemonError('invalid', `${id} is not a skill id`);
    const body = EvalBody.parse(await c.req.json());
    if (body.id !== id) throw new DaemonError('invalid', `the eval is for ${body.id}, not ${id}`);
    await writeJsonAtomic(join(ctx.ws.stintDir, 'evals', `${id}.json`), body);
    const carrier = [...body.evidence.map((r) => r.split('/')[0] as string), ...body.tasks];
    let task: string | null = null;
    for (const t of carrier) if (!task && (await ctx.ws.readTask(t).then(() => true, () => false))) task = t;
    if (task) {
      await ctx.ws.events(task).append({ task, vendor: 'daemon', type: 'skill.evaluated', payload: { id, with: body.with, without: body.without, replay: body.replay, card: body.card }, links: [{ kind: 'skill', ref: id }] });
    }
    return c.json({ id, recordedOn: task });
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
