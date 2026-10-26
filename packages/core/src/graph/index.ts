import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJSON, sha256Hex } from '../canonical';
import type { StintEvent } from '../schemas/event';
import type { Finding } from '../schemas/review';
import type { Task } from '../schemas/task';
import type { Decision } from '../store/decisions';
import { KeyedQueue } from '../store/files';
import type { Workspace } from '../store/workspace';

/**
 * The memory graph: a projection, not a store. Nodes and edges are computed from each
 * task's events.jsonl and decisions.md, then cached in .stint/cache/graph.sqlite.
 * Deleting the cache loses nothing; the next query rebuilds it from the task files.
 * Every edge carries recordedAt and validTo (null while valid), so asking for the
 * graph as of a moment is a filter, never a second data structure.
 */

export type GraphNodeType = 'task' | 'run' | 'decision' | 'file' | 'finding' | 'skill' | 'outcome' | 'merge';
export type GraphEdgeType =
  | 'touches'
  | 'produced'
  | 'constrains'
  | 'supersedes'
  | 'co_changed'
  | 'open_against'
  | 'applied_in'
  | 'proposed_from'
  | 'resulted_in'
  | 'similar_to';

export type GraphNode = { id: string; type: GraphNodeType; label: string; data: Record<string, unknown> };
export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type: GraphEdgeType;
  recordedAt: string;
  validTo: string | null;
  eventId: string;
  data: Record<string, unknown>;
};
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type ProjectOptions = { tasks?: string[]; cache?: boolean };
export type GraphOptions = { cache?: boolean };

export type SimilarRow = { task: string; score: number; evidence: { files: string[]; themes: string[]; tags: string[] } };
export type FilesTogetherRow = { path: string; count: number };
export type ConstrainsRow = {
  kind: 'decision' | 'finding';
  id: string;
  node: string;
  task: string;
  text: string;
  files: string[];
  recordedAt: string;
  validTo: string | null;
  run?: string;
  contradictsDecision?: string;
  supersedes?: string;
};
export type OpenFindingRow = {
  id: string;
  node: string;
  task: string;
  run: string;
  file: string | null;
  text: string;
  severity: string | null;
  contradictsDecision: string | null;
  linksTo: string | null;
  recordedAt: string;
};
export type SkillsHelpedRow = { skill: string; appliedIn: string[]; approvedAfter: number; hurt: number };

const taskNodeId = (task: string) => `task:${task}`;
const runNodeId = (task: string, run: string) => `run:${task}/${run}`;
const decisionNodeId = (task: string, id: string) => `decision:${task}/${id}`;
const fileNodeId = (path: string) => `file:${path}`;
const findingNodeId = (task: string, run: string, id: string) => `finding:${task}/${run}#${id}`;
const skillNodeId = (skill: string) => `skill:${skill}`;
const outcomeNodeId = (outcome: string) => `outcome:${outcome}`;
const mergeNodeId = (commit: string) => `merge:${commit}`;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** ISO times do not sort as text across precisions and offsets, so compare parsed values. */
const cmpTime = (a: string, b: string) => {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (!Number.isNaN(x) && !Number.isNaN(y) && x !== y) return x - y;
  return cmpStr(a, b);
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'without', 'is', 'are', 'was', 'were',
  'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'them', 'they', 'than', 'then', 'so', 'as',
  'at', 'by', 'from', 'into', 'through', 'per', 'over', 'under', 'would', 'should', 'could', 'must', 'not',
  'no', 'never', 'always', 'like', 'other', 'another', 'when', 'which', 'while', 'has', 'have', 'had',
  'use', 'used', 'using', 'every', 'each', 'one', 'two', 'new', 'now',
]);

/** Lowercase, trimmed, singular: "Limits," and "limit" are the same word here. */
function normaliseWord(raw: string): string {
  let w = raw.toLowerCase().replace(/^[^a-z]+|[^a-z-]+$/g, '');
  if (w.endsWith("'s")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

/** Theme words of a finding: its linksTo ref plus the significant words of its text. */
export function findingThemes(f: { text: string; linksTo?: string }): string[] {
  const themes = new Set<string>();
  if (f.linksTo) themes.add(f.linksTo.toLowerCase());
  for (const m of f.text.matchAll(/[A-Za-z]+(?:-[A-Za-z]+)*/g)) {
    const w = normaliseWord(m[0]);
    if (!w || STOPWORDS.has(w)) continue;
    if (w.length >= 4 || w.includes('-')) themes.add(w);
  }
  return [...themes].sort(cmpStr);
}

type At = { ts: string; eventId: string };
type RunInfo = {
  task: string;
  run: string;
  first: At;
  startedAt: string | null;
  endedAt: string | null;
  data: Record<string, unknown>;
};
type DecisionInfo = {
  task: string;
  id: string;
  recordedAt: string;
  by: string;
  text: string;
  supersedes?: string;
  evidence: string[];
  validTo: string | null;
  run: string | null;
  eventId: string | null;
};
type FindingInfo = {
  node: string;
  task: string;
  run: string;
  finding: Finding;
  recordedAt: string;
  eventId: string;
};
type Touch = { added: number; removed: number; changes: number } & At;
type OutcomeKind = 'approved' | 'rejected' | 'reverted' | 'followup' | 'ci' | 'incident';
type OutcomeInfo = { task: string; run: string | null; outcome: OutcomeKind; payload: Record<string, unknown> } & At;
type MergeInfo = { task: string; commit: string; into: string | null } & At;
type TaskInfo = {
  task: Task;
  created: At;
  files: Map<string, At>;
  filesByRun: Map<string, Map<string, At>>;
  themes: Map<string, At>;
  tags: string[];
};

type Collected = {
  tasks: TaskInfo[];
  runs: Map<string, RunInfo>;
  decisions: DecisionInfo[];
  findings: FindingInfo[];
  touches: Map<string, Touch & { task: string; run: string; path: string }>;
  outcomes: OutcomeInfo[];
  merges: MergeInfo[];
  applied: Array<{ skill: string; task: string; run: string } & At>;
  proposals: Array<{ skill: string; refs: string[] } & At>;
  skills: Map<string, Record<string, unknown>>;
};

function emptyCollected(): Collected {
  return { tasks: [], runs: new Map(), decisions: [], findings: [], touches: new Map(), outcomes: [], merges: [], applied: [], proposals: [], skills: new Map() };
}

function ensureRun(c: Collected, task: string, run: string, at: At): RunInfo {
  const key = `${task}/${run}`;
  let info = c.runs.get(key);
  if (!info) {
    info = { task, run, first: at, startedAt: null, endedAt: null, data: {} };
    c.runs.set(key, info);
  }
  return info;
}

async function collectTask(ws: Workspace, task: Task, c: Collected): Promise<void> {
  const events = await ws.events(task.id).read();
  const ledger = await ws.decisions(task.id).read();
  const info: TaskInfo = {
    task,
    created: { ts: task.createdAt, eventId: '' },
    files: new Map(),
    filesByRun: new Map(),
    themes: new Map(),
    tags: [...(task.tags ?? [])].sort(cmpStr),
  };
  c.tasks.push(info);

  const decisions = new Map<string, DecisionInfo>();
  for (const d of ledger) {
    decisions.set(d.id, { task: task.id, id: d.id, recordedAt: d.recordedAt, by: d.by, text: d.text, ...(d.supersedes ? { supersedes: d.supersedes } : {}), evidence: d.evidence, validTo: d.validTo, run: null, eventId: null });
  }

  for (const e of events) {
    const at: At = { ts: e.ts, eventId: e.id };
    const p = e.payload;
    switch (e.type) {
      case 'task.created':
        if (!info.created.eventId) info.created = at;
        break;
      case 'run.started': {
        if (!e.run) break;
        const r = ensureRun(c, task.id, e.run, at);
        r.startedAt = e.ts;
        r.first = at;
        r.data = { ...r.data, role: str(p.role), model: str(p.model), host: str(p.host), adapter: e.adapter ?? str(p.adapter), vendor: e.vendor ?? str(p.vendor), handoffFrom: str(p.handoffFrom) };
        break;
      }
      case 'run.finished': {
        if (!e.run) break;
        const r = ensureRun(c, task.id, e.run, at);
        r.endedAt = e.ts;
        r.data = { ...r.data, endedBy: str(p.endedBy), cost: obj(p.cost), ...(str(p.host) ? { host: str(p.host) } : {}) };
        break;
      }
      case 'file.changed': {
        const path = str(p.path);
        if (!path) break;
        if (!info.files.has(path)) info.files.set(path, at);
        const run = e.run ?? str(p.run);
        if (!run) break;
        ensureRun(c, task.id, run, at);
        let byRun = info.filesByRun.get(run);
        if (!byRun) info.filesByRun.set(run, (byRun = new Map()));
        if (!byRun.has(path)) byRun.set(path, at);
        const key = `${task.id}/${run}` + '\0' + path;
        const prev = c.touches.get(key);
        if (prev) {
          prev.added += num(p.added);
          prev.removed += num(p.removed);
          prev.changes += 1;
        } else {
          c.touches.set(key, { task: task.id, run, path, ...at, added: num(p.added), removed: num(p.removed), changes: 1 });
        }
        break;
      }
      case 'decision.recorded': {
        const id = str(p.id);
        if (!id) break;
        const prev = decisions.get(id);
        if (prev) {
          prev.run = e.run ?? prev.run;
          prev.eventId = e.id;
        } else {
          decisions.set(id, {
            task: task.id, id, recordedAt: e.ts, by: str(p.by) ?? (e.adapter ? `${e.adapter} ${e.run ?? ''}`.trim() : 'unknown'),
            text: str(p.text) ?? '', ...(str(p.supersedes) ? { supersedes: str(p.supersedes) as string } : {}),
            evidence: Array.isArray(p.evidence) ? p.evidence.filter((x): x is string => typeof x === 'string') : [],
            validTo: null, run: e.run ?? null, eventId: e.id,
          });
        }
        break;
      }
      case 'review.recorded': {
        const review = obj(p.review);
        const list = review && Array.isArray(review.findings) ? review.findings : Array.isArray(p.findings) && typeof p.findings[0] === 'object' ? p.findings : [];
        const run = e.run ?? str(review?.run) ?? 'unknown';
        if (e.run) ensureRun(c, task.id, e.run, at);
        for (const raw of list) {
          const f = obj(raw);
          const fid = f && str(f.id);
          const text = f && str(f.text);
          if (!f || !fid || !text) continue;
          const finding = f as unknown as Finding;
          c.findings.push({ node: findingNodeId(task.id, run, fid), task: task.id, run, finding, recordedAt: e.ts, eventId: e.id });
          for (const theme of findingThemes({ text, ...(str(f.linksTo) ? { linksTo: str(f.linksTo) as string } : {}) })) {
            if (!info.themes.has(theme)) info.themes.set(theme, at);
          }
        }
        break;
      }
      case 'skill.applied': {
        const skill = str(p.skill);
        const run = e.run ?? str(p.run);
        if (!skill || !run) break;
        ensureRun(c, task.id, run, at);
        if (!c.skills.has(skill)) c.skills.set(skill, {});
        c.applied.push({ skill, task: task.id, run, ...at });
        break;
      }
      case 'skill.proposed': {
        const proposal = obj(p.proposal);
        const skill = str(p.id) ?? str(proposal?.id) ?? str(p.skill);
        if (!skill) break;
        if (!c.skills.has(skill)) c.skills.set(skill, { ...(str(proposal?.name) ? { name: str(proposal?.name) } : {}), proposedFrom: task.id });
        const refs = (Array.isArray(p.evidence) ? p.evidence : Array.isArray(proposal?.evidence) ? proposal.evidence : []).filter((x): x is string => typeof x === 'string');
        c.proposals.push({ skill, refs, ...at });
        break;
      }
      case 'skill.approved':
      case 'skill.rejected': {
        const skill = str(p.id) ?? str(p.skill);
        if (!skill) break;
        const prev = c.skills.get(skill) ?? {};
        c.skills.set(skill, { ...prev, status: e.type === 'skill.approved' ? 'approved' : 'rejected' });
        break;
      }
      case 'approval.granted':
      case 'approval.rejected':
        c.outcomes.push({ task: task.id, run: e.run ?? str(p.run) ?? str(p.verificationRun), outcome: e.type === 'approval.granted' ? 'approved' : 'rejected', payload: p, ...at });
        break;
      case 'merge.completed': {
        const commit = str(p.commit);
        if (commit) c.merges.push({ task: task.id, commit, into: str(p.into), ...at });
        break;
      }
      case 'outcome.reverted':
      case 'outcome.followup':
      case 'outcome.ci':
      case 'outcome.incident':
        c.outcomes.push({ task: task.id, run: e.run ?? null, outcome: e.type.slice('outcome.'.length) as OutcomeKind, payload: p, ...at });
        break;
      default:
        break;
    }
  }

  for (const d of decisions.values()) {
    if (d.supersedes) {
      const old = decisions.get(d.supersedes);
      if (old && old.validTo === null) old.validTo = d.recordedAt;
    }
  }
  c.decisions.push(...decisions.values());
}

function later(a: At, b: At): At {
  return cmpTime(a.ts, b.ts) >= 0 ? a : b;
}

/** Shared files 2 points each, shared finding themes 3, shared tags 1. */
function similarity(a: TaskInfo, b: TaskInfo): (SimilarRow & { at: At }) | null {
  const files = [...a.files.keys()].filter((f) => b.files.has(f)).sort(cmpStr);
  const themes = [...a.themes.keys()].filter((t) => b.themes.has(t)).sort(cmpStr);
  const tags = a.tags.filter((t) => b.tags.includes(t));
  const score = files.length * 2 + themes.length * 3 + tags.length;
  if (score === 0) return null;
  const moments: At[] = [
    ...files.map((f) => later(a.files.get(f) as At, b.files.get(f) as At)),
    ...themes.map((t) => later(a.themes.get(t) as At, b.themes.get(t) as At)),
    ...(tags.length ? [later(a.created, b.created)] : []),
  ];
  moments.sort((x, y) => cmpTime(x.ts, y.ts) || cmpStr(x.eventId, y.eventId));
  return { task: b.task.id, score, evidence: { files, themes, tags }, at: moments[0] as At };
}

function resolvedAt(c: Collected, fi: FindingInfo): string | null {
  const carriers = c.findings.filter((x) => x.task === fi.task && x.finding.id === fi.finding.id && x.finding.resolvedBy && cmpTime(x.recordedAt, fi.recordedAt) >= 0);
  carriers.sort((x, y) => cmpTime(x.recordedAt, y.recordedAt));
  const carrier = carriers[0];
  if (!carrier) return null;
  const ref = carrier.finding.resolvedBy as string;
  const run = ref.includes('/') ? (ref.split('/').at(-1) as string) : ref;
  const info = c.runs.get(`${fi.task}/${run}`);
  if (info) return info.endedAt ?? info.startedAt ?? info.first.ts;
  return carrier.recordedAt;
}

function build(c: Collected): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeIds = new Map<string, number>();
  const addNode = (node: GraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (type: GraphEdgeType, from: string, to: string, recordedAt: string, validTo: string | null, eventId: string, data: Record<string, unknown>) => {
    const base = `${type}:${from}->${to}:${eventId || recordedAt}`;
    const n = (edgeIds.get(base) ?? 0) + 1;
    edgeIds.set(base, n);
    edges.push({ id: n === 1 ? base : `${base}#${n}`, from, to, type, recordedAt, validTo, eventId, data });
  };

  for (const t of c.tasks) {
    addNode({ id: taskNodeId(t.task.id), type: 'task', label: t.task.title, data: { task: t.task.id, title: t.task.title, status: t.task.status, tags: t.tags, createdAt: t.task.createdAt } });
  }
  for (const r of c.runs.values()) {
    addNode({ id: runNodeId(r.task, r.run), type: 'run', label: `${r.task}/${r.run}`, data: { task: r.task, run: r.run, ...r.data, startedAt: r.startedAt, endedAt: r.endedAt } });
    addEdge('produced', taskNodeId(r.task), runNodeId(r.task, r.run), r.startedAt ?? r.first.ts, null, r.first.eventId, { task: r.task, run: r.run });
  }
  const fileTasks = new Map<string, Set<string>>();
  for (const t of c.tasks) for (const path of t.files.keys()) (fileTasks.get(path) ?? fileTasks.set(path, new Set()).get(path))?.add(t.task.id);
  for (const [path, tasks] of fileTasks) addNode({ id: fileNodeId(path), type: 'file', label: path, data: { path, tasks: [...tasks].sort(cmpStr) } });

  for (const t of c.touches.values()) {
    addEdge('touches', runNodeId(t.task, t.run), fileNodeId(t.path), t.ts, null, t.eventId, { task: t.task, run: t.run, path: t.path, added: t.added, removed: t.removed, changes: t.changes });
  }
  for (const t of c.tasks) {
    for (const [run, files] of t.filesByRun) {
      const paths = [...files.keys()].sort(cmpStr);
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          const a = files.get(paths[i] as string) as At;
          const b = files.get(paths[j] as string) as At;
          const at = later(a, b);
          addEdge('co_changed', fileNodeId(paths[i] as string), fileNodeId(paths[j] as string), at.ts, null, at.eventId, { task: t.task.id, run });
        }
      }
    }
  }

  const byTask = new Map(c.tasks.map((t) => [t.task.id, t]));
  for (const d of c.decisions) {
    addNode({ id: decisionNodeId(d.task, d.id), type: 'decision', label: d.text || d.id, data: { task: d.task, decision: d.id, text: d.text, by: d.by, recordedAt: d.recordedAt, validTo: d.validTo, ...(d.supersedes ? { supersedes: d.supersedes } : {}), evidence: d.evidence, ...(d.run ? { run: d.run } : {}) } });
    const taskInfo = byTask.get(d.task);
    const runFiles = d.run ? taskInfo?.filesByRun.get(d.run) : undefined;
    const files = runFiles && runFiles.size > 0 ? [...runFiles.keys()] : [...(taskInfo?.files.keys() ?? [])];
    for (const path of files.sort(cmpStr)) {
      addEdge('constrains', decisionNodeId(d.task, d.id), fileNodeId(path), d.recordedAt, d.validTo, d.eventId ?? decisionNodeId(d.task, d.id), { task: d.task, decision: d.id, path, scope: runFiles && runFiles.size > 0 ? 'run' : 'task' });
    }
    if (d.supersedes) addEdge('supersedes', decisionNodeId(d.task, d.id), decisionNodeId(d.task, d.supersedes), d.recordedAt, null, d.eventId ?? decisionNodeId(d.task, d.id), { task: d.task, decision: d.id, supersedes: d.supersedes });
  }

  for (const fi of c.findings) {
    const f = fi.finding;
    addNode({
      id: fi.node, type: 'finding', label: f.text,
      data: { task: fi.task, run: fi.run, finding: f.id, severity: f.severity, text: f.text, recordedAt: fi.recordedAt, ...(f.file ? { file: f.file } : {}), ...(f.line ? { line: f.line } : {}), ...(f.linksTo ? { linksTo: f.linksTo } : {}), ...(f.contradictsDecision ? { contradictsDecision: f.contradictsDecision } : {}), ...(f.resolvedBy ? { resolvedBy: f.resolvedBy } : {}) },
    });
    if (f.file) {
      if (!nodes.has(fileNodeId(f.file))) addNode({ id: fileNodeId(f.file), type: 'file', label: f.file, data: { path: f.file, tasks: [fi.task] } });
      addEdge('open_against', fi.node, fileNodeId(f.file), fi.recordedAt, resolvedAt(c, fi), fi.eventId, { task: fi.task, run: fi.run, finding: f.id, path: f.file });
    }
  }

  for (const [skill, data] of c.skills) addNode({ id: skillNodeId(skill), type: 'skill', label: skill, data: { skill, ...data } });
  for (const a of c.applied) addEdge('applied_in', skillNodeId(a.skill), runNodeId(a.task, a.run), a.ts, null, a.eventId, { task: a.task, run: a.run, skill: a.skill });
  for (const p of c.proposals) {
    for (const ref of p.refs) {
      const m = /^(T-[0-9]+)\/(r[0-9]+)#(F[0-9]+)$/.exec(ref);
      if (!m) continue;
      const target = findingNodeId(m[1] as string, m[2] as string, m[3] as string);
      if (!nodes.has(target)) addNode({ id: target, type: 'finding', label: ref, data: { task: m[1], run: m[2], finding: m[3], text: '', recordedAt: p.ts } });
      addEdge('proposed_from', skillNodeId(p.skill), target, p.ts, null, p.eventId, { skill: p.skill, evidence: ref });
    }
  }

  const producedMerges = new Set<string>();
  for (const o of c.outcomes) {
    addNode({ id: outcomeNodeId(o.outcome), type: 'outcome', label: o.outcome, data: { outcome: o.outcome } });
    if (o.outcome === 'approved' || o.outcome === 'rejected') {
      let run = o.run;
      if (!run) {
        const candidates = [...c.runs.values()].filter((r) => r.task === o.task && cmpTime(r.endedAt ?? r.startedAt ?? r.first.ts, o.ts) <= 0);
        candidates.sort((x, y) => cmpTime(y.endedAt ?? y.startedAt ?? y.first.ts, x.endedAt ?? x.startedAt ?? x.first.ts));
        run = candidates[0]?.run ?? null;
      }
      if (!run) continue;
      addEdge('resulted_in', runNodeId(o.task, run), outcomeNodeId(o.outcome), o.ts, null, o.eventId, { task: o.task, run, outcome: o.outcome });
      continue;
    }
    // Post-merge outcomes hang from the merge itself: merge -> outcome (R-030).
    const p = o.payload;
    const known = new Map(c.merges.filter((m) => m.task === o.task).map((m) => [m.commit, m]));
    const byTime = c.merges.filter((m) => m.task === o.task && cmpTime(m.ts, o.ts) <= 0).sort((x, y) => cmpTime(y.ts, x.ts))[0];
    const mergeCommit =
      str(p.mergeCommit) ?? str(p.revertedCommit) ?? (str(p.commit) && known.has(str(p.commit) as string) ? str(p.commit) : null) ?? byTime?.commit ?? null;
    const data: Record<string, unknown> = {
      task: o.task,
      outcome: o.outcome,
      ...(mergeCommit ? { commit: mergeCommit, mergeCommit } : {}),
      ...(str(p.commit) ? { outcomeCommit: str(p.commit) } : {}),
      ...(str(p.by) ? { by: str(p.by) } : {}),
      ...(str(p.followup) ? { followup: str(p.followup) } : {}),
      ...(Array.isArray(p.files) ? { files: p.files.filter((f): f is string => typeof f === 'string') } : {}),
      ...(str(p.status) ? { status: str(p.status) } : {}),
      ...(str(p.summary) ? { summary: str(p.summary) } : {}),
    };
    if (mergeCommit) {
      const merge = known.get(mergeCommit);
      addNode({ id: mergeNodeId(mergeCommit), type: 'merge', label: mergeCommit.slice(0, 10), data: { task: o.task, commit: mergeCommit, mergeCommit, ...(merge?.into ? { into: merge.into } : {}), ...(merge ? { mergedAt: merge.ts } : {}) } });
      if (!producedMerges.has(mergeCommit)) {
        producedMerges.add(mergeCommit);
        addEdge('produced', taskNodeId(o.task), mergeNodeId(mergeCommit), merge?.ts ?? o.ts, null, merge?.eventId ?? o.eventId, { task: o.task, commit: mergeCommit });
      }
      addEdge('resulted_in', mergeNodeId(mergeCommit), outcomeNodeId(o.outcome), o.ts, null, o.eventId, data);
    } else {
      addEdge('resulted_in', taskNodeId(o.task), outcomeNodeId(o.outcome), o.ts, null, o.eventId, data);
    }
  }

  for (let i = 0; i < c.tasks.length; i++) {
    for (let j = i + 1; j < c.tasks.length; j++) {
      const a = c.tasks[i] as TaskInfo;
      const b = c.tasks[j] as TaskInfo;
      const sim = similarity(a, b);
      if (sim) addEdge('similar_to', taskNodeId(a.task.id), taskNodeId(b.task.id), sim.at.ts, null, sim.at.eventId, { score: sim.score, evidence: sim.evidence });
    }
  }

  return {
    nodes: [...nodes.values()].sort((x, y) => cmpStr(x.id, y.id)),
    edges: edges.sort((x, y) => cmpStr(x.id, y.id)),
  };
}

async function buildGraph(ws: Workspace, only?: string[]): Promise<Graph> {
  const all = await ws.listTasks();
  const tasks = only ? all.filter((t) => only.includes(t.id)) : all;
  const c = emptyCollected();
  for (const task of tasks) await collectTask(ws, task, c);
  c.tasks.sort((a, b) => cmpStr(a.task.id, b.task.id));
  return build(c);
}

const GRAPH_VERSION = 2;
const META_NODE = 'meta:cache-key';
const cacheQueue = new KeyedQueue();

export function graphCachePath(ws: Workspace): string {
  return join(ws.cacheDir, 'graph.sqlite');
}

/** The cache key: the max seq of every task plus the hash of every decisions.md. */
async function cacheKey(ws: Workspace): Promise<string> {
  const rows: Array<{ task: string; seq: number; decisions: string }> = [];
  for (const task of await ws.listTasks()) {
    const dir = await ws.taskDir(task.id);
    let seq = 0;
    try {
      const lines = (await readFile(join(dir, 'events.jsonl'), 'utf8')).split('\n').filter((l) => l.length > 0);
      const last = lines.at(-1);
      if (last) seq = num((JSON.parse(last) as { seq?: unknown }).seq);
    } catch {
      seq = 0;
    }
    let decisions = '';
    try {
      decisions = sha256Hex(await readFile(join(dir, 'decisions.md'), 'utf8'));
    } catch {
      decisions = sha256Hex('');
    }
    rows.push({ task: task.id, seq, decisions });
  }
  rows.sort((a, b) => cmpStr(a.task, b.task));
  return sha256Hex(canonicalJSON({ version: GRAPH_VERSION, rows }));
}

function readCache(ws: Workspace, key: string): Graph | null {
  const path = graphCachePath(ws);
  if (!existsSync(path)) return null;
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true });
    const meta = db.query('SELECT data FROM nodes WHERE id = ?').get(META_NODE) as { data: string } | null;
    if (!meta || (JSON.parse(meta.data) as { key?: string }).key !== key) return null;
    const nodeRows = db.query('SELECT id, type, label, data FROM nodes WHERE id != ? ORDER BY id').all(META_NODE) as Array<{ id: string; type: string; label: string; data: string }>;
    const edgeRows = db.query('SELECT id, from_id, to_id, type, recorded_at, valid_to, event_id, data FROM edges ORDER BY id').all() as Array<{ id: string; from_id: string; to_id: string; type: string; recorded_at: string; valid_to: string | null; event_id: string; data: string }>;
    return {
      nodes: nodeRows.map((r) => ({ id: r.id, type: r.type as GraphNodeType, label: r.label, data: JSON.parse(r.data) as Record<string, unknown> })),
      edges: edgeRows.map((r) => ({ id: r.id, from: r.from_id, to: r.to_id, type: r.type as GraphEdgeType, recordedAt: r.recorded_at, validTo: r.valid_to, eventId: r.event_id, data: JSON.parse(r.data) as Record<string, unknown> })),
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function writeCache(ws: Workspace, key: string, graph: Graph): Promise<void> {
  await mkdir(ws.cacheDir, { recursive: true });
  let db: Database | null = null;
  try {
    db = new Database(graphCachePath(ws), { create: true });
    db.exec('DROP TABLE IF EXISTS nodes; DROP TABLE IF EXISTS edges;');
    db.exec('CREATE TABLE nodes (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, data TEXT NOT NULL);');
    db.exec('CREATE TABLE edges (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL, recorded_at TEXT NOT NULL, valid_to TEXT, event_id TEXT NOT NULL, data TEXT NOT NULL);');
    const putNode = db.query('INSERT INTO nodes (id, type, label, data) VALUES (?, ?, ?, ?)');
    const putEdge = db.query('INSERT INTO edges (id, from_id, to_id, type, recorded_at, valid_to, event_id, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    db.transaction(() => {
      putNode.run(META_NODE, 'meta', 'cache key', JSON.stringify({ key }));
      for (const n of graph.nodes) putNode.run(n.id, n.type, n.label, JSON.stringify(n.data));
      for (const e of graph.edges) putEdge.run(e.id, e.from, e.to, e.type, e.recordedAt, e.validTo, e.eventId, JSON.stringify(e.data));
    })();
  } catch (err) {
    // The cache is rebuildable; say plainly that this write did not happen and carry on uncached.
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', message: `graph cache was NOT written: ${err instanceof Error ? err.message : String(err)}` })}\n`);
  } finally {
    db?.close();
  }
}

/**
 * The full projection, served from .stint/cache/graph.sqlite while its key is fresh.
 * A task subset or cache: false always builds from the task files and writes nothing.
 */
export function project(ws: Workspace, o: ProjectOptions = {}): Promise<Graph> {
  if (o.tasks || o.cache === false) return buildGraph(ws, o.tasks);
  return cacheQueue.run(graphCachePath(ws), async () => {
    const key = await cacheKey(ws);
    const cached = readCache(ws, key);
    if (cached) return cached;
    const graph = await buildGraph(ws);
    await writeCache(ws, key, graph);
    return graph;
  });
}

/** Edges valid at ts (recordedAt <= ts < validTo, null validTo never ends) and the nodes they touch. */
export function asOf(graph: Graph, ts: string): Graph {
  const edges = graph.edges.filter((e) => cmpTime(e.recordedAt, ts) <= 0 && (e.validTo === null || cmpTime(ts, e.validTo) < 0));
  const touched = new Set<string>();
  for (const e of edges) {
    touched.add(e.from);
    touched.add(e.to);
  }
  return { nodes: graph.nodes.filter((n) => touched.has(n.id)), edges };
}

async function requireTask(ws: Workspace, taskId: string): Promise<void> {
  await ws.readTask(taskId);
}

const dataStr = (n: GraphNode | undefined, key: string): string | null => (n ? str(n.data[key]) : null);

/** Tasks most similar to this one, best first, each with the evidence named. */
export async function similar(ws: Workspace, taskId: string, o: GraphOptions = {}): Promise<SimilarRow[]> {
  await requireTask(ws, taskId);
  const graph = await project(ws, o);
  const me = taskNodeId(taskId);
  const rows: SimilarRow[] = [];
  for (const e of graph.edges) {
    if (e.type !== 'similar_to') continue;
    const other = e.from === me ? e.to : e.to === me ? e.from : null;
    if (!other) continue;
    const ev = obj(e.data.evidence) ?? {};
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    rows.push({ task: other.slice('task:'.length), score: num(e.data.score), evidence: { files: strs(ev.files), themes: strs(ev.themes), tags: strs(ev.tags) } });
  }
  return rows.sort((a, b) => b.score - a.score || cmpStr(a.task, b.task));
}

/** Files changed in the same runs as this one, most often first. */
export async function filesTogether(ws: Workspace, path: string, o: GraphOptions = {}): Promise<FilesTogetherRow[]> {
  const graph = await project(ws, o);
  const me = fileNodeId(path);
  const counts = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.type !== 'co_changed') continue;
    const other = e.from === me ? e.to : e.to === me ? e.from : null;
    if (!other) continue;
    const otherPath = other.slice('file:'.length);
    counts.set(otherPath, (counts.get(otherPath) ?? 0) + 1);
  }
  return [...counts.entries()].map(([p, count]) => ({ path: p, count })).sort((a, b) => b.count - a.count || cmpStr(a.path, b.path));
}

function taskFiles(graph: Graph, taskId: string): Set<string> {
  const files = new Set<string>();
  for (const e of graph.edges) {
    if (e.type === 'touches' && e.data.task === taskId && typeof e.data.path === 'string') files.add(e.data.path);
  }
  return files;
}

/**
 * Decisions and open findings that apply to this task's files, valid at the time asked
 * (default: still valid now). A decision from another task on a shared file applies too;
 * its row names the task that made it.
 */
export async function constrains(ws: Workspace, taskId: string, at?: string, o: GraphOptions = {}): Promise<ConstrainsRow[]> {
  await requireTask(ws, taskId);
  const full = await project(ws, o);
  const graph = at ? asOf(full, at) : full;
  const valid = (e: GraphEdge) => (at ? true : e.validTo === null);
  const files = taskFiles(full, taskId);
  const nodes = new Map(full.nodes.map((n) => [n.id, n]));
  const grouped = new Map<string, ConstrainsRow>();
  const add = (e: GraphEdge, kind: 'decision' | 'finding', path: string) => {
    const node = nodes.get(e.from);
    if (!node) return;
    const id = dataStr(node, kind === 'decision' ? 'decision' : 'finding') ?? e.from;
    let row = grouped.get(e.from);
    if (!row) {
      row = {
        kind, id, node: e.from, task: dataStr(node, 'task') ?? taskId, text: dataStr(node, 'text') ?? node.label,
        files: [], recordedAt: dataStr(node, 'recordedAt') ?? e.recordedAt, validTo: e.validTo,
        ...(dataStr(node, 'run') ? { run: dataStr(node, 'run') as string } : {}),
        ...(dataStr(node, 'contradictsDecision') ? { contradictsDecision: dataStr(node, 'contradictsDecision') as string } : {}),
        ...(dataStr(node, 'supersedes') ? { supersedes: dataStr(node, 'supersedes') as string } : {}),
      };
      grouped.set(e.from, row);
    }
    if (!row.files.includes(path)) row.files.push(path);
  };
  for (const e of graph.edges) {
    if (!valid(e)) continue;
    const path = typeof e.data.path === 'string' ? e.data.path : null;
    if (!path || !files.has(path)) continue;
    if (e.type === 'constrains') add(e, 'decision', path);
    else if (e.type === 'open_against') add(e, 'finding', path);
  }
  const rows = [...grouped.values()];
  for (const r of rows) r.files.sort(cmpStr);
  const order = (r: ConstrainsRow) => (r.kind === 'decision' ? 0 : 1);
  return rows.sort((a, b) => order(a) - order(b) || cmpStr(a.task, b.task) || cmpStr(a.id, b.id));
}

/** Findings of this task that nothing has resolved yet. */
export async function openFindings(ws: Workspace, taskId: string, o: GraphOptions = {}): Promise<OpenFindingRow[]> {
  await requireTask(ws, taskId);
  const graph = await project(ws, o);
  const openEdges = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) if (e.type === 'open_against') (openEdges.get(e.from) ?? openEdges.set(e.from, []).get(e.from))?.push(e);
  const rows: OpenFindingRow[] = [];
  for (const n of graph.nodes) {
    if (n.type !== 'finding' || n.data.task !== taskId) continue;
    const edges = openEdges.get(n.id) ?? [];
    const resolved = edges.length > 0 ? edges.every((e) => e.validTo !== null) : Boolean(n.data.resolvedBy);
    if (resolved) continue;
    rows.push({
      id: dataStr(n, 'finding') ?? n.id, node: n.id, task: taskId, run: dataStr(n, 'run') ?? '',
      file: dataStr(n, 'file'), text: dataStr(n, 'text') ?? n.label, severity: dataStr(n, 'severity'),
      contradictsDecision: dataStr(n, 'contradictsDecision'), linksTo: dataStr(n, 'linksTo'),
      recordedAt: dataStr(n, 'recordedAt') ?? '',
    });
  }
  return rows.sort((a, b) => cmpStr(a.run, b.run) || cmpStr(a.id, b.id));
}

/**
 * Each applied skill, the runs it was applied in, and how many approvals followed an
 * application in the same task with no rejection in between.
 */
export async function skillsHelped(ws: Workspace, o: GraphOptions = {}): Promise<SkillsHelpedRow[]> {
  const graph = await project(ws, o);
  const bySkill = new Map<string, { appliedIn: Set<string>; at: Array<{ task: string; ts: string }> }>();
  for (const e of graph.edges) {
    if (e.type !== 'applied_in') continue;
    const skill = e.from.slice('skill:'.length);
    const task = typeof e.data.task === 'string' ? e.data.task : '';
    const run = typeof e.data.run === 'string' ? e.data.run : '';
    let row = bySkill.get(skill);
    if (!row) bySkill.set(skill, (row = { appliedIn: new Set(), at: [] }));
    row.appliedIn.add(`${task}/${run}`);
    row.at.push({ task, ts: e.recordedAt });
  }
  const outcomes = graph.edges.filter((e) => e.type === 'resulted_in');
  const rows: SkillsHelpedRow[] = [];
  for (const [skill, info] of bySkill) {
    let approvedAfter = 0;
    let hurt = 0;
    for (const o of outcomes) {
      // A reverted task with the skill mounted counts as hurt (R-030, for R-031).
      if (o.data.outcome === 'reverted') {
        if (info.at.some((a) => a.task === o.data.task && cmpTime(a.ts, o.recordedAt) <= 0)) hurt += 1;
        continue;
      }
      if (o.data.outcome !== 'approved') continue;
      const applied = info.at.filter((a) => a.task === o.data.task && cmpTime(a.ts, o.recordedAt) <= 0).sort((x, y) => cmpTime(x.ts, y.ts))[0];
      if (!applied) continue;
      const rejectedBetween = outcomes.some((r) => r.data.outcome === 'rejected' && r.data.task === o.data.task && cmpTime(r.recordedAt, applied.ts) > 0 && cmpTime(r.recordedAt, o.recordedAt) <= 0);
      if (!rejectedBetween) approvedAfter += 1;
    }
    rows.push({ skill, appliedIn: [...info.appliedIn].sort(cmpStr), approvedAfter, hurt });
  }
  return rows.sort((a, b) => cmpStr(a.skill, b.skill));
}
