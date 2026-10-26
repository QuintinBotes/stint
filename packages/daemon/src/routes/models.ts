import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { constrainsFiles, findingThemes, relayFromEvents, runsFromEvents, similar } from '@stint-dev/core/node';
import {
  type Host,
  buildPlanPrompt,
  buildReviewPrompt,
  findContradictions,
  hostsFromConfig,
  renderPlanMarkdown,
} from '@stint-dev/adapter-openai-compatible';
import { type Plan, PlanSchema, type Review, ReviewSchema, type StintEvent, renderHandoff } from '@stint-dev/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { ChainExhaustedError, walkChain } from '../route';
import { skillsFor } from '../skills';

const ROOT_SCHEMAS = join(import.meta.dir, '..', '..', '..', 'core', 'schemas');
const HostBody = z.strictObject({ host: z.enum(['meta-api', 'fireworks', 'baseten', 'modal', 'ollama']).optional() });

// built per call: hosts come from this workspace's config, and building them makes no request
const hosts = (ctx: DaemonContext): Record<string, Host> => hostsFromConfig(ctx.ws.config) as Record<string, Host>;

/** The chain for a role, or only the entries on one host when the caller names it. */
function chainFor(ctx: DaemonContext, role: 'planner' | 'reviewer', host?: string): string[] {
  const chain = ctx.ws.config.routes[role];
  const picked = host ? chain.filter((e) => e.startsWith(`${host}/`)) : chain;
  if (picked.length === 0) throw new DaemonError('adapter_unavailable', `no ${role} entry on ${host}`, chain.join(', '));
  return picked;
}

async function nextRun(ctx: DaemonContext, task: string): Promise<string> {
  const events = await ctx.ws.events(task).read();
  const n = events.filter((e) => e.type === 'run.started').reduce((m, e) => Math.max(m, Number(e.run?.slice(1) ?? 0)), 0);
  const fromDirs = Number((await ctx.ws.runs(task).nextRunId()).slice(1));
  return `r${Math.max(n + 1, fromDirs)}`;
}

/** A plan or review call is a run on the timeline like any other: started, finished, priced, with the host that answered. */
async function modelRun<T>(
  ctx: DaemonContext,
  taskId: string,
  role: 'planner' | 'reviewer',
  host: string | undefined,
  schemaFile: string,
  zodSchema: z.ZodType<T>,
  prompt: string,
  skip: string[] = [],
): Promise<{ value: T; run: string; host: string; model: string }> {
  const chain = chainFor(ctx, role, host).filter((e) => !skip.includes(e));
  if (chain.length === 0) throw new DaemonError('review_blocked', `every ${role} entry is the model that built this change (${skip.join(', ')})`, 'add a reviewer on another model to routes.reviewer, or set review.crossVendor to false');
  const run = await nextRun(ctx, taskId);
  const events = ctx.ws.events(taskId);
  const first = chain[0] as string;
  const base = { task: taskId, run, adapter: 'openai-compatible', vendor: 'meta' as const };
  await ctx.ws.runs(taskId).create({ run, adapter: 'openai-compatible', vendor: 'meta', role, model: first.split('/').slice(1).join('/'), host: first.split('/')[0] as string, startedAt: new Date().toISOString() });
  await events.append({ ...base, type: 'run.started', payload: { role, model: first.split('/').slice(1).join('/'), host: first.split('/')[0], chain, offline: first.startsWith('ollama/'), ...(skip.length ? { skipped: skip } : {}) } });
  const jsonSchema = JSON.parse(await Bun.file(join(ROOT_SCHEMAS, schemaFile)).text());
  try {
    const r = await walkChain<{ value: T }>({
      role,
      chain,
      hosts: hosts(ctx),
      emit: (e) => events.append({ ...base, type: e.type, payload: e.payload }).then(() => undefined),
      call: (h, model, c) => h.complete(zodSchema as never, jsonSchema, prompt, { model, timeoutMs: c.timeoutMs, emit: c.emit }),
    });
    const value = ((r.value as { value?: T }).value ?? r.value) as T;
    await ctx.ws.runs(taskId).updateMeta(run, { endedAt: new Date().toISOString(), endedBy: 'completed', cost: r.cost, host: r.host, model: r.model });
    await events.append({ ...base, type: 'run.finished', payload: { endedBy: 'completed', cost: r.cost, host: r.host, model: r.model, offline: r.host === 'ollama', ...(role === 'planner' ? { plan: value } : {}) } });
    void ctx.otel.run(taskId, run).catch(() => undefined);
    return { value, run, host: r.host, model: r.model };
  } catch (err) {
    const message = err instanceof ChainExhaustedError ? err.message : err instanceof Error ? err.message : String(err);
    await events.append({ ...base, type: 'run.finished', payload: { endedBy: 'failed', cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null, estimated: true }, reason: message } });
    void ctx.otel.run(taskId, run).catch(() => undefined);
    throw new DaemonError('adapter_unavailable', `no ${role} host could answer`, message);
  }
}

/** Plans a task with the planner chain: a run on the timeline, plan.json and plan.md, and the plan's decisions recorded. */
/** Paths a task names before it has touched any: its context files and the paths written in its goal and acceptance. */
export function namedFiles(task: { goal: string; acceptance: string[] }, context: unknown): string[] {
  const out = new Set<string>();
  const files = (context as { files?: Array<{ path?: unknown }> } | null)?.files;
  if (Array.isArray(files)) for (const f of files) if (typeof f.path === 'string') out.add(f.path);
  for (const m of `${task.goal}\n${task.acceptance.join('\n')}`.matchAll(/(?:^|[\s`'"(])((?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,5})(?=$|[\s`'"),.:;])/gim)) {
    const path = m[1] as string;
    if (path.includes('/') || /\.(ts|tsx|js|json|md|py|go|rs|sql|yml|yaml|toml)$/.test(path)) out.add(path);
  }
  return [...out];
}

/**
 * What the memory says about a task before it is planned (R-036): the three most similar tasks with why, and
 * the decisions and open findings on the files it names or that its similar tasks touched.
 */
export async function planMemory(ctx: DaemonContext, id: string, context: unknown): Promise<{ similar: Array<{ id: string; title: string; summary: string }>; constraints: NonNullable<Plan['constraints']> }> {
  const task = await ctx.ws.readTask(id);
  const rows = (await similar(ctx.ws, id).catch(() => [])).slice(0, 3);
  const similarTasks = [];
  for (const r of rows) {
    const t = await ctx.ws.readTask(r.task).catch(() => null);
    if (!t) continue;
    const why = [r.evidence.files.length ? `shares ${r.evidence.files.slice(0, 3).join(', ')}` : '', r.evidence.themes.length ? `on ${r.evidence.themes.slice(0, 3).join(', ')}` : '', r.evidence.tags.length ? `tagged ${r.evidence.tags.join(', ')}` : ''].filter(Boolean).join('; ');
    similarTasks.push({ id: t.id, title: t.title, summary: `${t.status}${why ? `; ${why}` : ''}. ${t.goal}`.slice(0, 300) });
  }
  const files = [...new Set([...namedFiles(task, context), ...rows.flatMap((r) => r.evidence.files)])];
  const constraints = files.length
    ? (await constrainsFiles(ctx.ws, id, files).catch(() => []))
        .filter((c) => c.task !== id)
        .slice(0, 20)
        .map((c) => ({ kind: c.kind, id: c.id.slice(0, 80), task: c.task, text: c.text.slice(0, 400), files: c.files.slice(0, 20) }))
    : [];
  return { similar: similarTasks, constraints };
}

export async function planTask(ctx: DaemonContext, id: string, host?: string): Promise<Plan> {
  const task = await ctx.ws.readTask(id);
  const context = await ctx.ws.readDoc<unknown>(id, 'context.json');
  const memory = await planMemory(ctx, id, context);
  const prompt = buildPlanPrompt({
    task: { id: task.id, title: task.title, goal: task.goal, acceptance: task.acceptance },
    ...(context ? { context } : {}),
    similarTasks: memory.similar,
    constraints: memory.constraints,
    skills: skillsFor(ctx.ws.root, 'planner'),
  });
  const r = await modelRun<Plan>(ctx, id, 'planner', host, 'plan.schema.json', PlanSchema, prompt);
  // the plan may name only the similar tasks it was shown; the constraints are the daemon's, never the model's
  const offered = new Set(memory.similar.map((t) => t.id));
  const subtasks = (r.value.subtasks ?? []).map((st, i) => ({ ...st, dependsOn: [...new Set(st.dependsOn.filter((d) => d < i))] }));
  const plan = await ctx.ws.writePlan(id, {
    ...r.value,
    similarTasks: r.value.similarTasks.filter((t) => offered.has(t)),
    constraints: memory.constraints,
    ...(subtasks.length ? { subtasks } : {}),
    model: `${r.host}/${r.model}`,
    offline: r.host === 'ollama',
    createdAt: new Date().toISOString(),
  });
  if ((plan.subtasks?.length ?? 0) >= 2) await decompose(ctx, id, plan, r.run);
  await writeFile(join(await ctx.ws.taskDir(id), 'plan.md'), renderPlanMarkdown(plan));
  // a decision the plan states is recorded like any other, with the planner run as provenance
  for (const d of plan.decisions ?? []) {
    const entry = await ctx.ws.decisions(id).append({ text: d.text, by: `openai-compatible ${r.run}`, evidence: [`${id}/${r.run}`] });
    await ctx.ws.events(id).append({ task: id, run: r.run, adapter: 'openai-compatible', vendor: 'meta', type: 'decision.recorded', payload: { id: entry.id, text: entry.text, by: entry.by }, links: [{ kind: 'decision', ref: entry.id }] });
  }
  return plan;
}

/**
 * Splits a task into the subtasks its plan named (R-036): one child task each, with the parent and the
 * children it waits for, recorded as task.decomposed on the parent. Planning the same task again splits nothing.
 */
export async function decompose(ctx: DaemonContext, id: string, plan: Plan, run: string): Promise<string[]> {
  const events = await ctx.ws.events(id).read();
  const done = events.find((e) => e.type === 'task.decomposed');
  if (done) return done.payload.children as string[];
  const parent = await ctx.ws.readTask(id);
  const children: string[] = [];
  const edges: Array<[string, string]> = [];
  for (const [i, st] of (plan.subtasks ?? []).entries()) {
    const child = await ctx.ws.createTask({ title: st.title, goal: st.goal, acceptance: st.acceptance, testCommand: parent.testCommand, tags: [...new Set([...(parent.tags ?? []), 'subtask'])] });
    const deps = st.dependsOn.map((d) => children[d] as string);
    await ctx.ws.writeTask(child.id, { parent: id, dependsOn: deps });
    for (const d of deps) edges.push([child.id, d]);
    children.push(child.id);
  }
  await ctx.ws.events(id).append({ task: id, run, adapter: 'openai-compatible', vendor: 'meta', type: 'task.decomposed', payload: { children, dependsOn: edges } });
  return children;
}

/** Reviews a task's change with the reviewer chain once its verification is green; contradictions go to the queue. */
/**
 * The reviewer entries that would be the same harness and model as the last implementer (R-035, D-042).
 * Stint's reviewer is Stint's own prompt on a chain model, so it is the same harness as the Stint agent;
 * any other coding agent is a different harness and may be reviewed by its own model.
 */
export function ownReviewers(ctx: DaemonContext, events: StintEvent[]): string[] {
  const impl = runsFromEvents(events).filter((r) => r.role === 'implementer').at(-1);
  if (!impl || impl.adapter !== 'stint-agent') return [];
  const model = (impl.model?.includes('/') ? impl.model.split('/').slice(1).join('/') : impl.model) ?? ctx.ws.config.routes.agent?.[0]?.split('/').slice(1).join('/');
  return model ? ctx.ws.config.routes.reviewer.filter((e) => e.split('/').slice(1).join('/') === model) : [];
}

type Lens = 'general' | 'security' | 'spec-fit';

/** The queue name of a finding that would reverse a decision; a lens other than the general one keeps its own ids. */
const contradictionId = (task: string, lens: string | undefined, finding: string) => (lens && lens !== 'general' && lens !== 'combined' ? `contradiction-${task}-${lens}-${finding}` : `contradiction-${task}-${finding}`);
const SEVERITY = { blocker: 0, major: 1, minor: 2, note: 3 } as const;
const VERDICT = { block: 0, request_changes: 1, approve: 2 } as const;
const worst = (verdicts: Review['verdict'][]): Review['verdict'] => [...verdicts].sort((a, b) => VERDICT[a] - VERDICT[b])[0] ?? 'approve';

/** The hosts of a chain in order, once each: best-of-n asks one reviewer per host (R-038). */
function distinctHosts(chain: string[], skip: string[], n: number): string[] {
  const out: string[] = [];
  for (const e of chain) {
    const h = e.split('/')[0] as string;
    if (!skip.includes(e) && !out.includes(h)) out.push(h);
  }
  return out.slice(0, n);
}

/**
 * Findings of several reviewers of one lens as one list: the same file and line, or two or more shared theme
 * words, is one finding, counted once per reviewer that found it (R-038).
 */
export function mergeFindings(lists: Review['findings'][]): Review['findings'] {
  const merged: Array<Review['findings'][number] & { agreement: number; themes: Set<string> }> = [];
  for (const list of lists) {
    const seen = new Set<number>();
    for (const f of list) {
      const themes = new Set(findingThemes({ text: f.text, ...(f.linksTo ? { linksTo: f.linksTo } : {}) }));
      const i = merged.findIndex((m, k) => !seen.has(k) && ((f.file && f.line && m.file === f.file && m.line === f.line) || [...themes].filter((t) => m.themes.has(t)).length >= 2));
      if (i >= 0) {
        const m = merged[i] as (typeof merged)[number];
        seen.add(i);
        m.agreement += 1;
        if (SEVERITY[f.severity] < SEVERITY[m.severity]) Object.assign(m, { severity: f.severity, text: f.text });
        continue;
      }
      seen.add(merged.length);
      merged.push({ ...f, agreement: 1, themes });
    }
  }
  return merged.map(({ themes: _t, ...f }) => f);
}

/** One review by one lens on the chain (or one host of it); its contradictions go to the queue. */
async function lensReview(ctx: DaemonContext, id: string, lens: Lens, host: string | undefined, skip: string[], base: { packetPrompt: string; diff: string; decisions: Array<{ id: string; text: string }>; acceptance: string[] }): Promise<Review> {
  const prompt = buildReviewPrompt({ ...base, skills: skillsFor(ctx.ws.root, 'reviewer'), ...(lens === 'general' ? {} : { lens }) });
  const r = await modelRun<Review>(ctx, id, 'reviewer', host, 'review.schema.json', ReviewSchema, prompt, skip);
  const value = { ...r.value, findings: r.value.findings.map((f) => ({ ...f, lens })) };
  const review = await ctx.ws.writeReview(id, { ...value, run: r.run, model: `${r.host}/${r.model}`, offline: r.host === 'ollama', createdAt: new Date().toISOString(), ...(lens === 'general' ? {} : { lens }) });
  // a finding that would reverse a decision is routed to the queue, never applied (non-negotiable 7)
  const contradicting = findContradictions(review, base.decisions);
  const queue = join(ctx.ws.cacheDir, 'queue');
  await mkdir(queue, { recursive: true });
  const queued: string[] = [];
  for (const f of contradicting) {
    const name = contradictionId(id, lens, f.id);
    const decision = base.decisions.find((d) => d.id === f.contradictsDecision) ?? null;
    await writeFile(join(queue, `${name}.json`), `${JSON.stringify({ kind: 'contradiction', task: id, run: r.run, agent: `${r.host}/${r.model}`, decision, finding: f, at: new Date().toISOString() }, null, 2)}\n`);
    queued.push(name);
  }
  await ctx.ws.events(id).append({
    task: id,
    run: r.run,
    adapter: 'openai-compatible',
    vendor: 'meta',
    type: 'review.recorded',
    payload: { verdict: review.verdict, findings: review.findings.length, contradictions: contradicting.length, offline: review.offline, queued, review, lens },
    links: review.findings.map((f) => ({ kind: 'finding' as const, ref: f.id })),
  });
  return review;
}

/**
 * Reviews a task's change once its verification is green: one review per lens in `review.lenses` (default only
 * the general one), and for the general lens `review.bestOf` reviewers on different hosts. When more than one
 * review ran, a combined review is the verdict the gate reads: any block blocks, any request for changes asks.
 */
export async function reviewTask(ctx: DaemonContext, id: string, host?: string): Promise<Review> {
  const task = await ctx.ws.readTask(id);
  if (ctx.runs.get(id)) throw new DaemonError('run_active', `${id} has a live run`, 'review runs after the run ends');
  const v = await ctx.ws.verification(id).latest();
  if (!v || v.status !== 'green') throw new DaemonError('verification_red', 'review is offered only after a green verification', v ? `${v.failed} failed` : 'nothing verified yet');
  const packet = await ctx.ws.handoffs(id).latest();
  const decisions = (await ctx.ws.decisions(id).validAt()).map((d) => ({ id: d.id, text: d.text }));
  const base = { packetPrompt: packet ? renderHandoff(packet) : `Task ${task.id}: ${task.goal}`, diff: (await ctx.worktrees.diff(task, 'unified')) as string, decisions, acceptance: task.acceptance };
  const skip = ctx.ws.config.review?.crossVendor === false ? [] : ownReviewers(ctx, await ctx.ws.events(id).read());
  const lenses = (ctx.ws.config.review?.lenses ?? ['general']) as Lens[];
  const bestOf = host ? 1 : (ctx.ws.config.review?.bestOf ?? 1);

  const done: Array<{ lens: Lens; review: Review }> = [];
  let disagreement = false;
  for (const lens of lenses) {
    if (lens === 'general' && bestOf > 1) {
      const hosts = distinctHosts(ctx.ws.config.routes.reviewer, skip, bestOf);
      const answers: Review[] = [];
      for (const h of hosts) {
        // a host that cannot answer leaves the others to decide; one answer is enough
        const r = await lensReview(ctx, id, lens, h, skip, base).catch(() => null);
        if (r) answers.push(r);
      }
      if (answers.length === 0) throw new DaemonError('adapter_unavailable', 'no reviewer could answer', hosts.join(', '));
      disagreement ||= new Set(answers.map((a) => a.verdict)).size > 1;
      for (const a of answers) done.push({ lens, review: a });
      continue;
    }
    done.push({ lens, review: await lensReview(ctx, id, lens, host, skip, base) });
  }

  let review = done[0]?.review as Review;
  if (done.length > 1) {
    const byLens = new Map<Lens, Review[]>();
    for (const d of done) byLens.set(d.lens, [...(byLens.get(d.lens) ?? []), d.review]);
    const findings = [...byLens.entries()]
      .flatMap(([lens, reviews]) => mergeFindings(reviews.map((r) => r.findings)).map((f) => ({ ...f, lens })))
      .sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity])
      .slice(0, 20)
      .map((f, i) => ({ ...f, id: `F${i + 1}` }));
    const verdict = worst(done.map((d) => d.review.verdict));
    const last = done.at(-1)?.review as Review;
    review = await ctx.ws.writeReview(id, {
      version: 'stint.review/1',
      verdict: findings.length === 0 ? 'approve' : verdict,
      summary: [...byLens.entries()].map(([lens, rs]) => `${lens}: ${worst(rs.map((r) => r.verdict)).replace('_', ' ')}`).join('; ').slice(0, 400),
      findings,
      blockers: [...new Set(done.flatMap((d) => d.review.blockers))].slice(0, 20),
      model: [...new Set(done.map((d) => d.review.model))].join(', ').slice(0, 200),
      offline: done.every((d) => d.review.offline),
      ...(last.run ? { run: last.run } : {}),
      createdAt: new Date().toISOString(),
      lens: 'combined',
      lenses: done.map((d) => ({ lens: d.lens, verdict: d.review.verdict, model: d.review.model, findings: d.review.findings.length, ...(d.review.run ? { run: d.review.run } : {}) })),
      ...(disagreement ? { disagreement: true } : {}),
    });
    await ctx.ws.events(id).append({
      task: id,
      ...(last.run ? { run: last.run } : {}),
      adapter: 'openai-compatible',
      vendor: 'meta',
      type: 'review.recorded',
      payload: { verdict: review.verdict, findings: review.findings.length, contradictions: 0, offline: review.offline, queued: [], review, lens: 'combined', ...(disagreement ? { disagreement: true } : {}) },
    });
  }

  if (review.verdict === 'block') {
    await ctx.ws.writeTask(id, { status: 'building', pendingAsk: review.blockers.join('; ').slice(0, 400) || 'The review blocked this change.' });
  } else {
    await ctx.ws.writeTask(id, { status: 'awaiting_approval' });
    await ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'approval.requested', payload: { verification: { passed: v.passed, failed: v.failed, status: v.status }, review: review.verdict } });
  }
  return review;
}

export type PendingContradiction = {
  id: string;
  kind: 'contradiction';
  task: string;
  run: string;
  agent: string;
  decision: { id: string; text: string } | null;
  finding: { id: string; text: string; file?: string; severity?: string; contradictsDecision?: string };
  at: string;
};

/** The queue is a projection of the logs: a finding that contradicts a decision waits until a person settles it. */
export async function pendingContradictions(ctx: DaemonContext): Promise<PendingContradiction[]> {
  const out: PendingContradiction[] = [];
  for (const t of await ctx.ws.listTasks()) {
    const events = await ctx.ws.events(t.id).read();
    const settled = new Set(events.map((e) => e.payload.queue).filter((q): q is string => typeof q === 'string'));
    const decisions = new Map((await ctx.ws.decisions(t.id).read()).map((d) => [d.id, d.text]));
    // a combined review repeats its lenses' findings; each contradiction is queued once, from the review that found it
    for (const e of events.filter((x) => x.type === 'review.recorded' && x.payload.lens !== 'combined')) {
      const review = e.payload.review as { model?: string; findings?: PendingContradiction['finding'][] } | undefined;
      for (const f of review?.findings ?? []) {
        if (!f.contradictsDecision) continue;
        const id = contradictionId(t.id, e.payload.lens as string | undefined, f.id);
        if (settled.has(id) || out.some((o) => o.id === id)) continue;
        const text = decisions.get(f.contradictsDecision);
        out.push({ id, kind: 'contradiction', task: t.id, run: e.run ?? '', agent: review?.model ?? e.adapter ?? 'reviewer', decision: text ? { id: f.contradictsDecision, text } : null, finding: f, at: e.ts });
      }
    }
  }
  return out;
}

export function modelRoutes(app: Hono, ctx: DaemonContext): void {
  app.post('/api/tasks/:id/plan', async (c) => {
    const { host } = HostBody.parse(await c.req.json().catch(() => ({})));
    return c.json(await planTask(ctx, c.req.param('id'), host));
  });

  app.post('/api/tasks/:id/review', async (c) => {
    const { host } = HostBody.parse(await c.req.json().catch(() => ({})));
    return c.json(await reviewTask(ctx, c.req.param('id'), host));
  });

  // a contradiction is settled by a person: keep the decision, or supersede it with the finding's view
  app.post('/api/graph/pending/:name', async (c) => {
    const name = c.req.param('name');
    const { action } = z.strictObject({ action: z.enum(['keep', 'supersede']) }).parse(await c.req.json());
    const item = (await pendingContradictions(ctx)).find((p) => p.id === name);
    if (!item) throw new DaemonError('not_found', `no queued item ${name}`);
    const events = ctx.ws.events(item.task);
    if (action === 'supersede' && item.decision) {
      const d = await ctx.ws.decisions(item.task).append({ text: item.finding.text.slice(0, 200), by: 'you', supersedes: item.decision.id, evidence: [`${item.task}/${item.run}#${item.finding.id}`] });
      await events.append({ task: item.task, vendor: 'human', type: 'decision.recorded', payload: { id: d.id, text: d.text, by: d.by, supersedes: item.decision.id, queue: name }, links: [{ kind: 'decision', ref: d.id }] });
    } else {
      await events.append({ task: item.task, vendor: 'human', type: 'human.command', payload: { text: `Kept ${item.decision?.id ?? 'the decision'}; ${item.finding.id} is not applied.`, queue: name } });
    }
    await rm(join(ctx.ws.cacheDir, 'queue', `${name}.json`), { force: true });
    return c.json({ ok: true, action });
  });

  app.get('/api/graph/pending', async (c) => c.json(await pendingContradictions(ctx)));

  // the whole floor: every run on its agent's lane, with the packets and skills that connect them
  app.get('/api/relay', async (c) => {
    const byTask = [];
    for (const t of await ctx.ws.listTasks()) byTask.push({ task: t.id, events: await ctx.ws.events(t.id).read() });
    return c.json(relayFromEvents(byTask));
  });
}
