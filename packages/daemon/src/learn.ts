import { join } from 'node:path';
import { hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import { type SkillProposal, SkillProposalSchema, countTokens } from '@stint-dev/core';
import { findingThemes, project, similar } from '@stint-dev/core/node';
import type { DaemonContext } from './app';
import { walkChain } from './route';
import { evidenceKey, listProposals, readRejected, scanSkillFiles, writeProposal } from './skills';

const LEARN_TOKEN_CAP = 20_000;
const SCHEMA_FILE = join(import.meta.dir, '..', '..', 'core', 'schemas', 'skill-proposal.schema.json');

export type FindingRef = { task: string; run: string; id: string; ref: string; text: string; linksTo: string | null };

export type LearnCandidate =
  | { kind: 'finding'; evidence: string[]; findings: FindingRef[] }
  | { kind: 'rejection'; evidence: string[]; findings: FindingRef[]; reason: string };

const dataStr = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Lowercase words with numbers and punctuation gone: two phrasings of one sentence compare equal here only rarely. */
function normalised(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function allFindings(ctx: DaemonContext): Promise<FindingRef[]> {
  const graph = await project(ctx.ws);
  const out: FindingRef[] = [];
  for (const n of graph.nodes) {
    if (n.type !== 'finding') continue;
    const task = dataStr(n.data.task);
    const run = dataStr(n.data.run);
    const id = dataStr(n.data.finding);
    const text = dataStr(n.data.text) ?? n.label;
    if (!task || !run || !id || !text) continue;
    out.push({ task, run, id, ref: `${task}/${run}#${id}`, text, linksTo: dataStr(n.data.linksTo) });
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref));
}

function findingCandidate(findings: FindingRef[], taskId: string): LearnCandidate | null {
  const themes = new Map(findings.map((f) => [f.ref, new Set(findingThemes({ text: f.text, ...(f.linksTo ? { linksTo: f.linksTo } : {}) }))]));
  let best: { evidence: FindingRef[]; score: number } | null = null;
  for (const mine of findings.filter((f) => f.task === taskId)) {
    const myThemes = themes.get(mine.ref) as Set<string>;
    const perTask = new Map<string, { f: FindingRef; score: number }>();
    for (const other of findings) {
      if (other.task === taskId) continue;
      const shared = [...myThemes].filter((t) => (themes.get(other.ref) as Set<string>).has(t)).length;
      const sameLink = mine.linksTo !== null && other.linksTo !== null && mine.linksTo.toLowerCase() === other.linksTo.toLowerCase();
      const sameText = normalised(mine.text) === normalised(other.text);
      if (!sameLink && !sameText && shared < 3) continue;
      const score = shared + (sameLink ? 10 : 0) + (sameText ? 10 : 0);
      const prev = perTask.get(other.task);
      if (!prev || score > prev.score) perTask.set(other.task, { f: other, score });
    }
    if (perTask.size === 0) continue;
    const others = [...perTask.values()].sort((a, b) => b.score - a.score || a.f.ref.localeCompare(b.f.ref));
    const score = others.reduce((s, o) => s + o.score, 0) + others.length * 100;
    if (!best || score > best.score) best = { evidence: [mine, ...others.map((o) => o.f)], score };
  }
  return best ? { kind: 'finding', evidence: best.evidence.map((f) => f.ref), findings: best.evidence } : null;
}

async function rejectionCandidate(ctx: DaemonContext, taskId: string): Promise<LearnCandidate | null> {
  type Hit = { task: string; run: string; reason: string };
  const byReason = new Map<string, Hit[]>();
  for (const task of await ctx.ws.listTasks()) {
    let lastRun: string | null = null;
    for (const e of await ctx.ws.events(task.id).read()) {
      if (e.run) lastRun = e.run;
      if (e.type !== 'approval.rejected') continue;
      const reason = dataStr(e.payload.reason);
      if (!reason || !lastRun) continue;
      const key = normalised(reason);
      if (!key) continue;
      const hits = byReason.get(key) ?? [];
      hits.push({ task: task.id, run: lastRun, reason });
      byReason.set(key, hits);
    }
  }
  for (const hits of byReason.values()) {
    if (!hits.some((h) => h.task === taskId)) continue;
    const refs = [...new Map(hits.map((h) => [`${h.task}/${h.run}#reject`, h])).entries()];
    const tasks = new Set(hits.map((h) => h.task));
    if (refs.length < 2) continue;
    if (tasks.size < 2 && refs.length < 2) continue;
    const evidence = refs.map(([ref]) => ref).sort();
    // the trigger task's own ref first, like a finding candidate
    evidence.sort((a, b) => Number(b.startsWith(`${taskId}/`)) - Number(a.startsWith(`${taskId}/`)) || a.localeCompare(b));
    return { kind: 'rejection', evidence, findings: [], reason: (hits.find((h) => h.task === taskId) as Hit).reason };
  }
  return null;
}

/**
 * The recurrence check, run on the graph and the event log, never on a model: a finding whose
 * normalised text, linksTo risk or theme words appear on at least two tasks, or a rejection
 * reason given twice. No candidate is the normal outcome and costs nothing.
 */
export async function findCandidate(ctx: DaemonContext, taskId: string): Promise<LearnCandidate | null> {
  const findings = await allFindings(ctx);
  return findingCandidate(findings, taskId) ?? (await rejectionCandidate(ctx, taskId));
}

async function taskSection(ctx: DaemonContext, taskId: string, findings: FindingRef[]): Promise<string[]> {
  const task = await ctx.ws.readTask(taskId).catch(() => null);
  if (!task) return [];
  const decisions = await ctx.ws.decisions(taskId).validAt().catch(() => []);
  const verifications = await ctx.ws.verification(taskId).list().catch(() => []);
  return [
    `Task ${task.id}: ${task.title}`,
    `Goal: ${task.goal}`,
    'Findings:',
    ...(findings.length ? findings.map((f) => `- ${f.ref}: ${f.text}`) : ['- none recorded']),
    'Decisions:',
    ...(decisions.length ? decisions.map((d) => `- ${d.id}: ${d.text}`) : ['- none recorded']),
    'Verification by the daemon:',
    ...(verifications.length
      ? verifications.map((v) => `- ${v.run}: ${v.command} ${v.status}, ${v.passed} passed, ${v.failed} failed`)
      : ['- none recorded']),
  ];
}

/** The one learn prompt: the recurring evidence, this task in full, and the three most similar tasks. */
export async function buildLearnPrompt(ctx: DaemonContext, taskId: string, candidate: LearnCandidate): Promise<string> {
  const task = await ctx.ws.readTask(taskId);
  const findings = await allFindings(ctx);
  const mine = findings.filter((f) => f.task === taskId);
  const diff = (await ctx.worktrees.diff(task, 'json').catch(() => [])) as Array<{ path: string; added: number; removed: number }>;
  const similarTasks = (await similar(ctx.ws, taskId).catch(() => [])).slice(0, 3);
  const lines = [
    'You are the learn step of Stint. A review finding or a rejection reason has recurred, and the',
    'evidence below proves the recurrence: the refs are the finding or rejection on each task.',
    'Propose one skill that would stop the next agent making the same mistake.',
    '',
    'Rules for the proposal:',
    '- id is lowercase words joined by dashes; name is a short title.',
    '- description says when the skill applies, in one or two sentences: it is the trigger text an agent reads.',
    '- rule is the skill body verbatim: the rule, the why, and the test to add. Plain words, present tense.',
    '- roles name who the skill mounts for; tags name which tasks it mounts on.',
    `- evidence is exactly these refs, in this order: ${candidate.evidence.join(', ')}`,
    '- examples name the runs the evidence came from.',
    '- confidence is how sure the recurrence is one rule and not two accidents, from 0 to 1.',
    '',
    candidate.kind === 'finding' ? 'The recurring findings:' : `The rejection reason given twice: ${candidate.reason}`,
    ...candidate.findings.map((f) => `- ${f.ref}: ${f.text}`),
    '',
    'This task:',
    ...(await taskSection(ctx, taskId, mine)),
    'Diff summary on the task branch:',
    ...(diff.length ? diff.map((d) => `- ${d.path} +${d.added} -${d.removed}`) : ['- none']),
    '',
    'The most similar earlier tasks:',
  ];
  if (similarTasks.length === 0) lines.push('- none');
  for (const s of similarTasks) {
    lines.push('', ...(await taskSection(ctx, s.task, findings.filter((f) => f.task === s.task))));
  }
  let prompt = lines.join('\n');
  if (countTokens(prompt) > LEARN_TOKEN_CAP) prompt = prompt.slice(0, LEARN_TOKEN_CAP * 3.6);
  return prompt;
}

async function skipped(ctx: DaemonContext, taskId: string, reason: string): Promise<void> {
  await ctx.ws.events(taskId).append({ task: taskId, vendor: 'daemon', type: 'learn.skipped', payload: { reason } });
}

/**
 * One learn pass for a task that was approved or rejected. Never throws: a failure anywhere is
 * `learn.skipped` with the reason, because the approval it followed has already happened.
 * There is no run record; `skill.proposed` carries the cost, host and model.
 */
export async function runLearn(ctx: DaemonContext, taskId: string): Promise<void> {
  try {
    const candidate = await findCandidate(ctx, taskId);
    if (!candidate) return skipped(ctx, taskId, 'no recurrence');
    const key = evidenceKey(candidate.evidence);
    if ((await readRejected(ctx.ws)).some((r) => r.evidenceKey === key)) return skipped(ctx, taskId, 'evidence was rejected before');
    if ((await listProposals(ctx.ws)).some((p) => evidenceKey(p.evidence) === key)) return skipped(ctx, taskId, 'already proposed');
    if (scanSkillFiles(ctx.ws.root).some((s) => s.frontmatter.status === 'active' && evidenceKey(s.frontmatter.evidence ?? []) === key)) {
      return skipped(ctx, taskId, 'already a skill');
    }

    const prompt = await buildLearnPrompt(ctx, taskId, candidate);
    const jsonSchema = JSON.parse(await Bun.file(SCHEMA_FILE).text()) as Record<string, unknown>;
    const events = ctx.ws.events(taskId);
    const r = await walkChain<{ value: SkillProposal }>({
      role: 'learn',
      chain: ctx.ws.config.routes.learn,
      hosts: hostsFromConfig(ctx.ws.config),
      emit: (e) => events.append({ task: taskId, vendor: 'daemon', type: e.type, payload: e.payload }).then(() => undefined),
      call: (h, model, c) => h.complete(SkillProposalSchema as never, jsonSchema as never, prompt, { model, timeoutMs: c.timeoutMs, emit: c.emit }),
    });
    const value = ((r.value as { value?: SkillProposal }).value ?? r.value) as SkillProposal;
    // the evidence is what the graph proved, not what the model repeats back
    const proposal = SkillProposalSchema.parse({
      ...value,
      evidence: candidate.evidence,
      model: `${r.host}/${r.model}`,
      createdAt: value.createdAt ?? new Date().toISOString(),
    });
    if (scanSkillFiles(ctx.ws.root).some((s) => s.id === proposal.id) || (await listProposals(ctx.ws)).some((p) => p.id === proposal.id)) {
      return skipped(ctx, taskId, `skill ${proposal.id} already exists`);
    }
    await writeProposal(ctx.ws, proposal);
    await events.append({
      task: taskId,
      vendor: 'daemon',
      type: 'skill.proposed',
      payload: { id: proposal.id, evidence: proposal.evidence, confidence: proposal.confidence, cost: r.cost, host: r.host, model: r.model },
      links: [{ kind: 'skill', ref: proposal.id }],
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await skipped(ctx, taskId, reason).catch(() => undefined);
  }
}

/** Starts a learn pass without delaying the caller; `ctx.pending` tracks it so a stop waits for it. */
export function triggerLearn(ctx: DaemonContext, taskId: string): void {
  const done = runLearn(ctx, taskId).catch(async (err: unknown) => {
    await skipped(ctx, taskId, err instanceof Error ? err.message : String(err)).catch(() => undefined);
  });
  ctx.pending.add(done);
  void done.finally(() => ctx.pending.delete(done));
}
