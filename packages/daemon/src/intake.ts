// Intake (R-041): work arrives from where teams already track it. An issue pulled from GitHub or Linear is an
// intake item, a file the daemon owns, never a task until a person accepts it. Each one is triaged on the planner
// chain: a size, a proposed title, goal and acceptance, the existing tasks it may duplicate, and a risk tier.
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type Host, hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import { readJsonIfExists, similarText, writeJsonAtomic } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { gh } from './git';
import { walkChain } from './route';

export type Source = 'github' | 'linear';
export type Triage = { size: 'S' | 'M' | 'L'; title: string; goal: string; acceptance: string[]; duplicates: string[]; risk: 'low' | 'medium' | 'high'; reason: string; model: string };
export type IntakeItem = {
  id: string;
  source: Source;
  ref: string;
  url: string | null;
  title: string;
  body: string;
  labels: string[];
  receivedAt: string;
  triage: Triage | null;
  triageError?: string;
  state: 'open' | 'accepted' | 'merged' | 'dismissed';
  task: string | null;
  reason?: string;
};

const TriageSchema = z.strictObject({
  size: z.enum(['S', 'M', 'L']),
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(2000),
  acceptance: z.array(z.string().min(1).max(300)).min(1).max(8),
  duplicates: z.array(z.string()).max(5),
  risk: z.enum(['low', 'medium', 'high']),
  reason: z.string().min(1).max(300),
});

const dir = (ctx: DaemonContext) => join(ctx.ws.root, '.stint', 'intake');
const itemId = (source: Source, ref: string) => `${source}-${ref}`.replace(/[^A-Za-z0-9-]/g, '-');
const itemPath = (ctx: DaemonContext, id: string) => join(dir(ctx), `${id}.json`);

export async function listItems(ctx: DaemonContext): Promise<IntakeItem[]> {
  if (!existsSync(dir(ctx))) return [];
  const items: IntakeItem[] = [];
  for (const f of (await readdir(dir(ctx))).filter((f) => f.endsWith('.json')).sort()) {
    const item = await readJsonIfExists<IntakeItem>(join(dir(ctx), f));
    if (item) items.push(item);
  }
  return items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

async function readItem(ctx: DaemonContext, id: string): Promise<IntakeItem> {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new DaemonError('invalid', `${id} is not an intake item id`);
  const item = await readJsonIfExists<IntakeItem>(itemPath(ctx, id));
  if (!item) throw new DaemonError('not_found', `no intake item ${id}`);
  return item;
}

const save = async (ctx: DaemonContext, item: IntakeItem) => {
  await mkdir(dir(ctx), { recursive: true });
  await writeJsonAtomic(itemPath(ctx, item.id), item);
};

type Raw = { ref: string; url: string | null; title: string; body: string; labels: string[] };

async function fromGithub(ctx: DaemonContext, o: { repo?: string; label?: string }): Promise<Raw[]> {
  const repo = o.repo ?? ctx.ws.config.intake?.github?.repo;
  const label = o.label ?? ctx.ws.config.intake?.github?.label;
  const r = await gh(ctx.ws.root, ['issue', 'list', '--json', 'number,title,body,url,labels', '--state', 'open', '--limit', '50', ...(repo ? ['--repo', repo] : []), ...(label ? ['--label', label] : [])]);
  if (r.code !== 0) throw new DaemonError('adapter_unavailable', 'gh issue list failed', r.stderr.trim().slice(0, 300) || 'is gh installed and logged in?');
  const issues = JSON.parse(r.stdout) as Array<{ number: number; title: string; body?: string; url?: string; labels?: Array<{ name: string }> }>;
  return issues.map((i) => ({ ref: String(i.number), url: i.url ?? null, title: i.title, body: i.body ?? '', labels: (i.labels ?? []).map((l) => l.name) }));
}

async function fromLinear(ctx: DaemonContext, o: { team?: string }): Promise<Raw[]> {
  const cfg = ctx.ws.config.intake?.linear;
  if (!cfg) throw new DaemonError('invalid', 'intake.linear is not configured', 'set intake.linear.keyEnv to the variable that holds your Linear key');
  const key = process.env[cfg.keyEnv];
  if (!key) throw new DaemonError('invalid', `${cfg.keyEnv} is not set`, 'the Linear key stays in your environment, named by intake.linear.keyEnv');
  const team = o.team ?? cfg.team;
  const query = `query Intake($team: String) { issues(first: 50, filter: { state: { type: { nin: ["completed", "canceled"] } }${team ? ', team: { key: { eq: $team } }' : ''} }) { nodes { identifier title description url labels { nodes { name } } } } }`;
  const res = await fetch(process.env.STINT_LINEAR_URL ?? 'https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query, variables: team ? { team } : {} }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new DaemonError('adapter_unavailable', `Linear answered ${res.status}`);
  const body = (await res.json()) as { data?: { issues?: { nodes?: Array<{ identifier: string; title: string; description?: string; url?: string; labels?: { nodes?: Array<{ name: string }> } }> } }; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new DaemonError('adapter_unavailable', `Linear refused the query: ${body.errors[0]?.message}`);
  return (body.data?.issues?.nodes ?? []).map((i) => ({ ref: i.identifier, url: i.url ?? null, title: i.title, body: i.description ?? '', labels: (i.labels?.nodes ?? []).map((l) => l.name) }));
}

/** Sizes, rewrites and dedupes one item with the planner chain; it may name as duplicates only the tasks it was shown. */
export async function triage(ctx: DaemonContext, item: IntakeItem): Promise<IntakeItem> {
  const matches = await similarText(ctx.ws, { title: item.title, goal: item.body.slice(0, 2000) }, 5);
  const candidates = [];
  for (const m of matches) {
    const t = await ctx.ws.readTask(m.task).catch(() => null);
    if (t) candidates.push({ id: t.id, title: t.title, goal: t.goal.slice(0, 300), status: t.status, why: m.why });
  }
  const prompt = [
    'You triage an issue for a coding factory before a person decides whether it becomes a task.',
    'Return only JSON. size: S for one agent run, M for a few, L for work that must be split. Propose a short title, a goal that says what done looks like, and 1 to 8 acceptance criteria a test could check.',
    'duplicates: the ids of tasks below that already cover this issue, and only those ids; an empty list when none does. risk: high when it touches access, money, data migrations, CI or deletes things; medium when it changes what other code calls; low otherwise. reason: one sentence on the size, the risk and any duplicate.',
    '',
    `## The issue (${item.source} ${item.ref})`,
    `Title: ${item.title}`,
    `Labels: ${item.labels.join(', ') || 'none'}`,
    item.body.slice(0, 4000) || '(no description)',
    '',
    '## Existing tasks with similar words',
    candidates.length ? candidates.map((c) => `- ${c.id} (${c.status}) ${c.title}: ${c.goal} [shares: ${c.why.join(', ')}]`).join('\n') : '- none',
  ].join('\n');
  try {
    const r = await walkChain<{ value: z.infer<typeof TriageSchema> }>({
      role: 'planner',
      chain: ctx.ws.config.routes.planner,
      hosts: hostsFromConfig(ctx.ws.config) as Record<string, Host>,
      call: (h, model, c) => h.complete(TriageSchema, prompt, { model, timeoutMs: c.timeoutMs, emit: c.emit }),
    });
    // an item is not a task yet, so its triage is spend in the workspace log
    await ctx.ws.workspaceEvents().append({ task: 'workspace', vendor: 'daemon', type: 'cost.recorded', payload: { for: 'triage', item: item.id, host: r.host, model: r.model, cost: r.cost } });
    const v =((r.value as { value?: z.infer<typeof TriageSchema> }).value ?? r.value) as z.infer<typeof TriageSchema>;
    const offered = new Set(candidates.map((c) => c.id));
    const next: IntakeItem = { ...item, triage: { ...v, duplicates: v.duplicates.filter((d) => offered.has(d)), model: `${r.host}/${r.model}` } };
    delete next.triageError;
    return next;
  } catch (err) {
    // no planner could answer: the item stays open with no triage, and says why; nothing is invented
    return { ...item, triage: null, triageError: err instanceof Error ? err.message : String(err) };
  }
}

/** Pulls open issues from a source; each one not seen before becomes an open item and is triaged. */
export async function pull(ctx: DaemonContext, source: Source, o: { repo?: string; label?: string; team?: string } = {}): Promise<{ received: string[]; triaged: number }> {
  const raw = source === 'github' ? await fromGithub(ctx, o) : await fromLinear(ctx, o);
  const received: string[] = [];
  let triaged = 0;
  for (const r of raw) {
    const id = itemId(source, r.ref);
    // an issue seen before, dismissed or not, is never pulled twice
    if (existsSync(itemPath(ctx, id))) continue;
    const item: IntakeItem = { id, source, ref: r.ref, url: r.url, title: r.title.slice(0, 200), body: r.body.slice(0, 8000), labels: r.labels, receivedAt: new Date().toISOString(), triage: null, state: 'open', task: null };
    await save(ctx, item);
    const done = await triage(ctx, item);
    await save(ctx, done);
    received.push(id);
    if (done.triage) triaged += 1;
  }
  return { received, triaged };
}

/** The scheduled pull: every source the config sets up, every 15 minutes. */
export async function scheduledPull(ctx: DaemonContext): Promise<void> {
  const intake = ctx.ws.config.intake;
  if (!intake) return;
  if (intake.github) await pull(ctx, 'github');
  if (intake.linear) await pull(ctx, 'linear');
}

const AcceptBody = z.strictObject({ title: z.string().min(1).max(120).optional(), goal: z.string().min(1).max(2000).optional(), acceptance: z.array(z.string().min(1).max(300)).min(1).max(12).optional() });

export function intakeRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/intake', async (c) => c.json(await listItems(ctx)));

  app.post('/api/intake/pull', async (c) => {
    const body = z.strictObject({ source: z.enum(['github', 'linear']), repo: z.string().max(200).optional(), label: z.string().max(100).optional(), team: z.string().max(50).optional() }).parse(await c.req.json());
    return c.json(await pull(ctx, body.source, body));
  });

  app.post('/api/intake/:id/accept', async (c) => {
    const item = await readItem(ctx, c.req.param('id'));
    if (item.state !== 'open') throw new DaemonError('invalid', `${item.id} is already ${item.state}`);
    const body = AcceptBody.parse(await c.req.json().catch(() => ({})));
    const task = await ctx.ws.createTask({
      title: body.title ?? item.triage?.title ?? item.title.slice(0, 120),
      goal: body.goal ?? item.triage?.goal ?? (item.body.slice(0, 2000) || item.title),
      acceptance: body.acceptance ?? item.triage?.acceptance ?? [item.title.slice(0, 300)],
      tags: ['intake'],
    });
    await ctx.ws.writeTask(task.id, { source: { kind: item.source, ref: item.ref, ...(item.url ? { url: item.url } : {}) }, ...(item.triage ? { risk: item.triage.risk } : {}), links: { beadsId: null, issueUrl: item.url } });
    // the history travels with the task: where it came from, and what triage said
    await ctx.ws.events(task.id).append({ task: task.id, vendor: 'daemon', type: 'intake.received', payload: { source: item.source, ref: item.ref, url: item.url, title: item.title, labels: item.labels } });
    await ctx.ws.events(task.id).append({ task: task.id, vendor: 'daemon', type: 'intake.triaged', payload: { triage: item.triage, ...(item.triageError ? { error: item.triageError } : {}) } });
    await save(ctx, { ...item, state: 'accepted', task: task.id });
    return c.json({ item: item.id, task: task.id }, 201);
  });

  app.post('/api/intake/:id/merge', async (c) => {
    const item = await readItem(ctx, c.req.param('id'));
    if (item.state !== 'open') throw new DaemonError('invalid', `${item.id} is already ${item.state}`);
    const { task: id } = z.strictObject({ task: z.string().regex(/^T-[0-9]{4,}$/) }).parse(await c.req.json());
    const task = await ctx.ws.readTask(id);
    await ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'intake.received', payload: { source: item.source, ref: item.ref, url: item.url, title: item.title, mergedInto: id } });
    if (!task.links.issueUrl && item.url) await ctx.ws.writeTask(id, { links: { ...task.links, issueUrl: item.url } });
    await save(ctx, { ...item, state: 'merged', task: id });
    return c.json({ item: item.id, task: id });
  });

  app.post('/api/intake/:id/dismiss', async (c) => {
    const item = await readItem(ctx, c.req.param('id'));
    const { reason } = z.strictObject({ reason: z.string().max(300).optional() }).parse(await c.req.json().catch(() => ({})));
    await save(ctx, { ...item, state: 'dismissed', ...(reason ? { reason } : {}) });
    return c.json({ item: item.id, state: 'dismissed' });
  });
}
