import type { Hono } from 'hono';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { type SkillBundleFile, type SkillFinding, type SkillSource, RoleSchema, SkillSourceSchema } from '@stint-dev/core';
import { writeJsonAtomic } from '@stint-dev/core/node';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { approveSkill, emitWorkspaceEvent, importSkill, keepSkill, listSkills, readSkillFolderFiles, rejectSkill, retireSkill, updateSkillStatuses } from '../skills';

const ApproveBody = z.strictObject({ by: z.string().min(1).max(80).optional(), acknowledge: z.array(z.string().min(1).max(120)).max(64).optional() });
const RejectBody = z.strictObject({ reason: z.string().min(1).max(400) });
const EmptyBody = z.strictObject({});
const Side = z.looseObject({ runs: z.number(), findings: z.number(), passed: z.number(), failed: z.number() });
const EvalBody = z.looseObject({ version: z.literal('stint.skillEval/1'), id: z.string(), replay: z.boolean(), tasks: z.array(z.string()), with: Side, without: Side, card: z.string().max(400), evidence: z.array(z.string()).default([]) });
const ImportJsonBody = z.strictObject({
  files: z
    .array(z.strictObject({ path: z.string().min(1).max(400), base64: z.string(), mode: z.int().min(0).optional() }))
    .min(1)
    .max(200),
  source: SkillSourceSchema,
  by: z.string().min(1).max(80).optional(),
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
  roles: z.array(RoleSchema).max(3).optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
});

// a zip a person drops is small (a bundle is at most 1 MB on the inside); this bounds the upload itself
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const badBundle = (findings: SkillFinding[]) => new DaemonError('skill_invalid', 'the skill bundle does not validate; fix the findings and import again', { findings });

/** An upload is read whole into memory, so it is refused once it passes 4 MB: a 1 MB bundle with room for base64 and multipart framing. */
const MAX_UPLOAD = 4 * 1024 * 1024;

async function cappedBody(req: Request): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_UPLOAD) throw badBundle([{ id: 'upload-too-large', severity: 'block', file: 'SKILL.md', text: `The upload is over ${MAX_UPLOAD} bytes. A skill bundle may hold at most 1048576 bytes; remove large assets and import again.` }]);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Unzips in memory, checking each name and size before it is even inflated (R-060). */
function filesFromZip(bytes: Uint8Array): SkillBundleFile[] {
  const problems: SkillFinding[] = [];
  let entries: Record<string, Uint8Array>;
  let count = 0;
  let declared = 0;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        // the bundle limits, from the zip's own directory, so a zip of many small files is never inflated whole
        count += 1;
        declared += file.originalSize;
        if (count > 64 || declared > 1024 * 1024) {
          if (!problems.some((p) => p.id === 'bundle-too-large')) problems.push({ id: 'bundle-too-large', severity: 'block', file: file.name, text: 'The zip holds more than 64 files or more than 1048576 bytes unzipped. Remove files and import again.' });
          return false;
        }
        if (file.name.includes('..') || file.name.startsWith('/') || file.name.includes('\\')) {
          problems.push({ id: 'bad-path', severity: 'block', file: file.name, text: `${file.name} reaches outside the skill folder. Fix the path in the zip and import again.` });
          return false;
        }
        if (file.originalSize > 256 * 1024) {
          problems.push({ id: 'file-too-large', severity: 'block', file: file.name, text: `${file.name} is ${file.originalSize} bytes unzipped; one file may be at most 262144 bytes.` });
          return false;
        }
        return true;
      },
    });
  } catch {
    throw badBundle([{ id: 'not-a-zip', severity: 'block', file: 'SKILL.md', text: 'The upload is not a readable zip. Drop a .zip, a SKILL.md, or a folder instead.' }]);
  }
  if (problems.length) throw badBundle(problems);
  return Object.entries(entries)
    .filter(([path]) => !path.endsWith('/'))
    .map(([path, data]) => ({ path, bytes: data }));
}

const isZip = (bytes: Uint8Array, name: string) => name.toLowerCase().endsWith('.zip') || (bytes[0] === 0x50 && bytes[1] === 0x4b);

type Upload = { files: SkillBundleFile[]; source: SkillSource; by?: string; id?: string; roles?: z.infer<typeof RoleSchema>[]; tags?: string[] };

async function multipartUpload(form: Awaited<ReturnType<Request['formData']>>): Promise<Upload> {
  const parts: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const [, raw] of form.entries()) {
    const value = raw as string | File;
    if (value instanceof File) {
      const bytes = new Uint8Array(await value.arrayBuffer());
      if (bytes.length > MAX_UPLOAD_BYTES) throw badBundle([{ id: 'bundle-too-large', severity: 'block', file: value.name || 'SKILL.md', text: `The upload is ${bytes.length} bytes; at most ${MAX_UPLOAD_BYTES} bytes are taken in one upload.` }]);
      parts.push({ name: value.name, bytes });
    }
  }
  if (!parts.length) throw badBundle([{ id: 'missing-skill-md', severity: 'block', file: 'SKILL.md', text: 'The upload holds no files. Drop a .zip, a SKILL.md, or a folder.' }]);
  const stringField = (name: string): string | undefined => {
    const value = form.get(name);
    return typeof value === 'string' && value ? value : undefined;
  };
  let source: SkillSource = { kind: 'upload', ref: parts[0]?.name || 'upload' };
  const sourceField = stringField('source');
  if (sourceField) {
    const parsed = SkillSourceSchema.safeParse(JSON.parse(sourceField) as unknown);
    if (!parsed.success) throw new DaemonError('invalid', 'the source field is not a skill source', 'send {"kind":"upload","ref":"<name>"} or leave it out');
    source = parsed.data;
  }
  const rolesField = stringField('roles');
  const tagsField = stringField('tags');
  const roles = rolesField ? z.array(RoleSchema).max(3).parse(JSON.parse(rolesField) as unknown) : undefined;
  const tags = tagsField ? z.array(z.string().min(1).max(60)).max(20).parse(JSON.parse(tagsField) as unknown) : undefined;
  const id = stringField('id');
  if (parts.length === 1 && isZip(parts[0]?.bytes as Uint8Array, parts[0]?.name as string)) {
    return { files: filesFromZip(parts[0]?.bytes as Uint8Array), source, ...(id ? { id } : {}), ...(roles ? { roles } : {}), ...(tags ? { tags } : {}) };
  }
  // each part's file name is its path in the bundle, so a folder keeps its shape
  const files = parts.map((part) => ({ path: part.name, bytes: part.bytes }));
  return { files, source, ...(stringField('by') ? { by: stringField('by') as string } : {}), ...(id ? { id } : {}), ...(roles ? { roles } : {}), ...(tags ? { tags } : {}) };
}

export function skillRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/skills', async (c) => c.json(await listSkills(ctx.ws)));

  app.get('/api/workspace/events', async (c) => {
    const since = Number(c.req.query('since') ?? 0) || 0;
    return c.json({ events: await ctx.ws.workspaceEvents().read({ since }) });
  });

  // the daemon is the gate (R-060): clients post bytes, the daemon validates and holds the proposal
  app.post('/api/skills/import', async (c) => {
    const type = c.req.header('Content-Type') ?? '';
    const raw = await cappedBody(c.req.raw);
    const upload: Upload = type.includes('multipart/form-data')
      ? await multipartUpload(await new Request(c.req.url, { method: 'POST', headers: { 'Content-Type': type }, body: raw }).formData())
      : await (async () => {
          const body = ImportJsonBody.parse(JSON.parse(new TextDecoder().decode(raw)));
          const files = body.files.map((f) => ({ path: f.path, bytes: new Uint8Array(Buffer.from(f.base64, 'base64')), ...(f.mode !== undefined ? { mode: f.mode } : {}) }));
          const single = files[0];
          const expanded = files.length === 1 && single && isZip(single.bytes, single.path) ? filesFromZip(single.bytes) : files;
          return {
            files: expanded,
            source: body.source,
            ...(body.by ? { by: body.by } : {}),
            ...(body.id ? { id: body.id } : {}),
            ...(body.roles ? { roles: body.roles } : {}),
            ...(body.tags ? { tags: body.tags } : {}),
          };
        })();
    const imported = await importSkill(ctx.ws, upload);
    return c.json(imported, 201);
  });

  app.get('/api/skills/:id/export', async (c) => {
    const id = c.req.param('id');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new DaemonError('invalid', `${id} is not a skill id`);
    if (!existsSync(join(ctx.ws.root, '.agents', 'skills', id, 'SKILL.md'))) throw new DaemonError('not_found', `no approved skill ${id}`, 'approve it first, or export an id from the skills list');
    const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
    for (const file of readSkillFolderFiles(ctx.ws.root, id)) entries[file.path] = [file.bytes, { mtime: new Date('1980-01-01T00:00:00Z') }];
    const zip = zipSync(entries);
    return new Response(Buffer.from(zip), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${id}.zip"` } });
  });

  app.post('/api/skills/:id/approve', async (c) => {
    const body = ApproveBody.parse(await c.req.json().catch(() => ({})));
    const approved = await approveSkill(ctx.ws, c.req.param('id'), body.by ?? 'you', body.acknowledge ?? []);
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
    } else {
      await emitWorkspaceEvent(ctx.ws, 'skill.evaluated', { id, with: body.with, without: body.without, replay: body.replay, card: body.card }, 'daemon');
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
