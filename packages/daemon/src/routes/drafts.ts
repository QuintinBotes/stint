import { DraftAnswerSchema, DraftKindSchema, DraftSchema, parseSpecKit, toSpecKit } from '@stint-dev/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { createFromDraft, draftSpec, refineDraft } from '../drafts';
import { DaemonError } from '../errors';

const NewBody = z.strictObject({ input: z.string().trim().min(1).max(2000), kind: DraftKindSchema.optional() });
const RefineBody = z.strictObject({ draft: DraftSchema, answers: z.array(DraftAnswerSchema).max(20) });
const ImportBody = z.strictObject({ spec: z.string().min(1).max(200_000), tasks: z.string().min(1).max(200_000).optional() });
const DraftBody = z.strictObject({ draft: DraftSchema });

/**
 * The spec builder (R-066). Drafting and refining ask a model, so a replay refuses them; opening a Spec Kit spec,
 * creating and exporting call none. Every POST needs the daemon token, and nothing but spend is written before create.
 */
export function draftRoutes(app: Hono, ctx: DaemonContext): void {
  app.post('/api/drafts', async (c) => {
    const { input, kind } = NewBody.parse(await c.req.json());
    return c.json(await draftSpec(ctx, input, kind));
  });

  app.post('/api/drafts/refine', async (c) => {
    const { draft, answers } = RefineBody.parse(await c.req.json());
    return c.json(await refineDraft(ctx, draft, answers));
  });

  app.post('/api/drafts/import', async (c) => {
    const { spec, tasks } = ImportBody.parse(await c.req.json());
    const r = parseSpecKit(spec, tasks);
    if (!r.ok) throw new DaemonError('invalid', 'the spec could not be read', r.problems);
    return c.json(r.draft);
  });

  app.post('/api/drafts/create', async (c) => {
    const { draft } = DraftBody.parse(await c.req.json());
    return c.json(await createFromDraft(ctx, draft), 201);
  });

  app.post('/api/drafts/export', async (c) => {
    const { draft } = DraftBody.parse(await c.req.json());
    return new Response(toSpecKit(draft), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
  });
}
