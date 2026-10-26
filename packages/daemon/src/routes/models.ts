import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Host,
  buildPlanPrompt,
  buildReviewPrompt,
  findContradictions,
  hostsFromConfig,
  renderPlanMarkdown,
} from '@stint-dev/adapter-openai-compatible';
import { type Plan, PlanSchema, type Review, ReviewSchema, renderHandoff } from '@stint-dev/core';
import { readJsonIfExists } from '@stint-dev/core/node';
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
async function modelRun<T>(ctx: DaemonContext, taskId: string, role: 'planner' | 'reviewer', host: string | undefined, schemaFile: string, zodSchema: z.ZodType<T>, prompt: string): Promise<{ value: T; run: string; host: string; model: string }> {
  const run = await nextRun(ctx, taskId);
  const events = ctx.ws.events(taskId);
  const chain = chainFor(ctx, role, host);
  const first = chain[0] as string;
  const base = { task: taskId, run, adapter: 'openai-compatible', vendor: 'meta' as const };
  await ctx.ws.runs(taskId).create({ run, adapter: 'openai-compatible', vendor: 'meta', role, model: first.split('/').slice(1).join('/'), host: first.split('/')[0] as string, startedAt: new Date().toISOString() });
  await events.append({ ...base, type: 'run.started', payload: { role, model: first.split('/').slice(1).join('/'), host: first.split('/')[0], chain, offline: first.startsWith('ollama/') } });
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
    return { value, run, host: r.host, model: r.model };
  } catch (err) {
    const message = err instanceof ChainExhaustedError ? err.message : err instanceof Error ? err.message : String(err);
    await events.append({ ...base, type: 'run.finished', payload: { endedBy: 'failed', cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null, estimated: true }, reason: message } });
    throw new DaemonError('adapter_unavailable', `no ${role} host could answer`, message);
  }
}

/** Plans a task with the planner chain: a run on the timeline, plan.json and plan.md, and the plan's decisions recorded. */
export async function planTask(ctx: DaemonContext, id: string, host?: string): Promise<Plan> {
  const task = await ctx.ws.readTask(id);
  const context = await ctx.ws.readDoc<unknown>(id, 'context.json');
  const prompt = buildPlanPrompt({
    task: { id: task.id, title: task.title, goal: task.goal, acceptance: task.acceptance },
    ...(context ? { context } : {}),
    skills: skillsFor(ctx.ws.root, 'planner'),
  });
  const r = await modelRun<Plan>(ctx, id, 'planner', host, 'plan.schema.json', PlanSchema, prompt);
  const plan = await ctx.ws.writePlan(id, { ...r.value, model: `${r.host}/${r.model}`, offline: r.host === 'ollama', createdAt: new Date().toISOString() });
  await writeFile(join(await ctx.ws.taskDir(id), 'plan.md'), renderPlanMarkdown(plan));
  // a decision the plan states is recorded like any other, with the planner run as provenance
  for (const d of plan.decisions ?? []) {
    const entry = await ctx.ws.decisions(id).append({ text: d.text, by: `openai-compatible ${r.run}`, evidence: [`${id}/${r.run}`] });
    await ctx.ws.events(id).append({ task: id, run: r.run, adapter: 'openai-compatible', vendor: 'meta', type: 'decision.recorded', payload: { id: entry.id, text: entry.text, by: entry.by }, links: [{ kind: 'decision', ref: entry.id }] });
  }
  return plan;
}

/** Reviews a task's change with the reviewer chain once its verification is green; contradictions go to the queue. */
export async function reviewTask(ctx: DaemonContext, id: string, host?: string): Promise<Review> {
  const task = await ctx.ws.readTask(id);
  if (ctx.runs.get(id)) throw new DaemonError('run_active', `${id} has a live run`, 'review runs after the run ends');
  const v = await ctx.ws.verification(id).latest();
  if (!v || v.status !== 'green') throw new DaemonError('verification_red', 'review is offered only after a green verification', v ? `${v.failed} failed` : 'nothing verified yet');
  const packet = await ctx.ws.handoffs(id).latest();
  const decisions = (await ctx.ws.decisions(id).validAt()).map((d) => ({ id: d.id, text: d.text }));
  const prompt = buildReviewPrompt({
    packetPrompt: packet ? renderHandoff(packet) : `Task ${task.id}: ${task.goal}`,
    diff: (await ctx.worktrees.diff(task, 'unified')) as string,
    decisions,
    skills: skillsFor(ctx.ws.root, 'reviewer'),
  });
  const r = await modelRun<Review>(ctx, id, 'reviewer', host, 'review.schema.json', ReviewSchema, prompt);
  const review = await ctx.ws.writeReview(id, { ...r.value, run: r.run, model: `${r.host}/${r.model}`, offline: r.host === 'ollama', createdAt: new Date().toISOString() });
  // a finding that would reverse a decision is routed to the queue, never applied (non-negotiable 7)
  const contradicting = findContradictions(review, decisions);
  const queue = join(ctx.ws.cacheDir, 'queue');
  await mkdir(queue, { recursive: true });
  const queued: string[] = [];
  for (const f of contradicting) {
    const name = `contradiction-${id}-${f.id}`;
    const decision = decisions.find((d) => d.id === f.contradictsDecision) ?? null;
    await writeFile(join(queue, `${name}.json`), `${JSON.stringify({ kind: 'contradiction', task: id, run: r.run, agent: `${r.host}/${r.model}`, decision, finding: f, at: new Date().toISOString() }, null, 2)}\n`);
    queued.push(name);
  }
  await ctx.ws.events(id).append({
    task: id,
    run: r.run,
    adapter: 'openai-compatible',
    vendor: 'meta',
    type: 'review.recorded',
    payload: { verdict: review.verdict, findings: review.findings.length, contradictions: contradicting.length, offline: review.offline, queued, review },
    links: review.findings.map((f) => ({ kind: 'finding' as const, ref: f.id })),
  });
  if (review.verdict === 'block') {
    await ctx.ws.writeTask(id, { status: 'building', pendingAsk: review.blockers.join('; ').slice(0, 400) || 'The review blocked this change.' });
  } else {
    await ctx.ws.writeTask(id, { status: 'awaiting_approval' });
    await ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'approval.requested', payload: { verification: { passed: v.passed, failed: v.failed, status: v.status }, review: review.verdict } });
  }
  return review;
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

  app.get('/api/graph/pending', async (c) => {
    const { readdir } = await import('node:fs/promises');
    const queue = join(ctx.ws.cacheDir, 'queue');
    const names = await readdir(queue).catch(() => [] as string[]);
    const items = [];
    for (const n of names.filter((x) => x.endsWith('.json')).sort()) items.push({ id: n.replace(/\.json$/, ''), ...(await readJsonIfExists<Record<string, unknown>>(join(queue, n))) });
    return c.json(items);
  });
}
