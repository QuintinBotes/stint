import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { type Role, type SkillProposal, type SkillStatus, type Task, SkillProposalSchema, parseSkillFrontmatter } from '@stint-dev/core';
import { type StintEvent, type Workspace, canonicalJSON, findingThemes, readJsonIfExists, sha256Hex, similar, writeFileAtomic, writeJsonAtomic } from '@stint-dev/core/node';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { git, gitOk, identityArgs } from './git';
import type { MountedSkill } from './prompt';

/** One side of a skill eval: every run with (or without) the skill mounted, summed (R-031). */
export type SkillEvalSide = {
  runs: number;
  findings: number;
  passed: number;
  failed: number;
  verified: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  usd: number | null;
};

/** The eval summary the Skills page shows, read from `.stint/evals/<id>.json`. */
export type SkillEvalSummary = {
  id: string;
  with: SkillEvalSide;
  without: SkillEvalSide;
  card: string;
  createdAt?: string;
  synthetic?: true;
  replay?: boolean;
};

const evalMoney = (usd: number | null) => (usd === null ? 'unpriced' : `$${usd.toFixed(4)}`);

/** The one line a proposal card and the Skills page print for an eval. */
export function formatSkillEvalCard(withSide: SkillEvalSide, withoutSide: SkillEvalSide): string {
  const side = (s: SkillEvalSide) => `${s.findings} findings, ${s.passed} passed, cost ${evalMoney(s.usd)}`;
  return `with skill: ${side(withSide)}; without: ${side(withoutSide)}`;
}

/**
 * A skill's record in the world (R-031): helped is a mounted task approved with no repeat
 * finding on the skill's theme; hurt is a mounted task with a repeat finding, a rejection,
 * or an outcome.reverted. Both count tasks, not events.
 */
export type SkillTrack = {
  appliedIn: string[];
  applied: number;
  helped: number;
  hurt: number;
  helpedTasks: string[];
  hurtTasks: string[];
};

export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  roles: Role[];
  tags: string[];
  origin: 'human' | 'learn-loop';
  status: SkillStatus;
  evidence: string[];
  stale: boolean;
  appliedIn: string[];
  helped: number;
  hurt: number;
  retireProposed: boolean;
  eval?: SkillEvalSummary;
};

export type RejectedProposal = { id: string; evidenceKey: string; reason: string; at: string };

const SKILL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function skillsDir(root: string): string {
  return join(root, '.agents', 'skills');
}

export function proposalsDir(ws: Workspace): string {
  return join(ws.cacheDir, 'proposals');
}

function consentPath(ws: Workspace): string {
  return join(ws.cacheDir, 'skills-consent.json');
}

/** The key a rejection is remembered by: the sorted evidence list, hashed. */
export function evidenceKey(evidence: string[]): string {
  return sha256Hex(canonicalJSON([...evidence].sort()));
}

type SkillFile = {
  id: string;
  file: string;
  content: string;
  frontmatter: ReturnType<typeof parseSkillFrontmatter>['frontmatter'];
  body: string;
};

/** Every readable skill file under `.agents/skills`, by directory name. A malformed file is skipped. */
export function scanSkillFiles(root: string): SkillFile[] {
  const dir = skillsDir(root);
  if (!existsSync(dir)) return [];
  const out: SkillFile[] = [];
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    try {
      const content = readFileSync(file, 'utf8');
      const { frontmatter, body } = parseSkillFrontmatter(content);
      out.push({ id: name, file, content, frontmatter, body });
    } catch {
      // a malformed skill is skipped here; nothing mounts a file Stint cannot read
    }
  }
  return out;
}

/** Which rule mounted a skill on a task (R-055), recorded as `by` in `skill.applied`. */
export type SkillMountRule = 'role' | 'tag' | 'similar';

/** A mounted skill with the rule that mounted it. */
export type MountedSkillForTask = MountedSkill & { by: SkillMountRule };

/**
 * The mounted skills, with the rule behind each: an untagged skill mounts by role, a tagged
 * one by a matching tag, and a tagged one with no matching tag by similarity when a task in
 * `similarTasks` is one of its evidence tasks. With `tags` not given, tags do not filter.
 */
function mountsFor(root: string, role: Role, tags: string[] | undefined, similarTasks: ReadonlySet<string>): MountedSkillForTask[] {
  const out: MountedSkillForTask[] = [];
  for (const s of scanSkillFiles(root)) {
    const fm = s.frontmatter;
    if (fm.status !== 'active' && fm.status !== 'probation') continue;
    if (fm.roles && !fm.roles.includes(role)) continue;
    const tagged = Boolean(fm.tags && fm.tags.length > 0);
    let by: SkillMountRule = 'role';
    if (tags && tagged) {
      if ((fm.tags as string[]).some((t) => tags.includes(t))) by = 'tag';
      else if ((fm.evidence ?? []).some((ref) => similarTasks.has(ref.split('/')[0] as string))) by = 'similar';
      else continue;
    }
    out.push({ name: fm.name, description: fm.description, by });
  }
  return out;
}

/**
 * Mounted skills in `.agents/skills` that apply to a role: active and probation both mount
 * (R-031). A skill without roles applies to every role; a skill without tags applies to every
 * task. When `tags` is given, a tagged skill mounts only when one of its tags is one of the task's tags.
 */
export function skillsFor(root: string, role: Role, tags?: string[]): MountedSkill[] {
  return mountsFor(root, role, tags, new Set());
}

/**
 * Mounted skills for one task (R-055): besides role and tag, a skill mounts by similarity when
 * one of the task's three most similar tasks, at or above `skills.similarity` (default 0.5),
 * is a task in the skill's evidence. A graph that cannot answer is said out loud and only the
 * role and tag rules mount.
 */
export async function skillsForTask(ws: Workspace, task: Pick<Task, 'id' | 'tags'>, role: Role): Promise<MountedSkillForTask[]> {
  const threshold = ws.config.skills?.similarity ?? 0.5;
  let similarTasks = new Set<string>();
  try {
    similarTasks = new Set(
      (await similar(ws, task.id))
        .slice(0, 3)
        .filter((r) => r.score >= threshold)
        .map((r) => r.task),
    );
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', message: `skills for ${task.id} were NOT checked against similar tasks: ${err instanceof Error ? err.message : String(err)}` })}\n`);
  }
  return mountsFor(ws.root, role, task.tags ?? [], similarTasks);
}

async function readConsent(ws: Workspace): Promise<Record<string, string>> {
  return (await readJsonIfExists<Record<string, string>>(consentPath(ws))) ?? {};
}

async function recordConsent(ws: Workspace, id: string, content: string): Promise<void> {
  const consent = await readConsent(ws);
  consent[id] = sha256Hex(content);
  await writeJsonAtomic(consentPath(ws), consent);
}

export async function listProposals(ws: Workspace): Promise<SkillProposal[]> {
  let names: string[] = [];
  try {
    names = await readdir(proposalsDir(ws));
  } catch {
    return [];
  }
  const out: SkillProposal[] = [];
  for (const name of names.filter((n) => n.endsWith('.json') && n !== 'rejected.json').sort()) {
    const raw = await readJsonIfExists<unknown>(join(proposalsDir(ws), name));
    const parsed = SkillProposalSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function readProposal(ws: Workspace, id: string): Promise<SkillProposal | null> {
  const raw = await readJsonIfExists<unknown>(join(proposalsDir(ws), `${id}.json`));
  if (raw === null) return null;
  const parsed = SkillProposalSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writeProposal(ws: Workspace, proposal: SkillProposal): Promise<void> {
  await writeJsonAtomic(join(proposalsDir(ws), `${proposal.id}.json`), SkillProposalSchema.parse(proposal));
}

export async function readRejected(ws: Workspace): Promise<RejectedProposal[]> {
  return (await readJsonIfExists<RejectedProposal[]>(join(proposalsDir(ws), 'rejected.json'))) ?? [];
}

async function recordRejected(ws: Workspace, entry: RejectedProposal): Promise<void> {
  const all = await readRejected(ws);
  if (!all.some((r) => r.id === entry.id && r.evidenceKey === entry.evidenceKey)) all.push(entry);
  await writeJsonAtomic(join(proposalsDir(ws), 'rejected.json'), all);
}

type FindingShape = { id?: unknown; text?: unknown; linksTo?: unknown };

const asRecord = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asStr = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Findings of one review event, in the two shapes the log carries (the review object, or a bare list). */
function findingsOf(e: StintEvent): Array<{ id: string; text: string; linksTo: string | null }> {
  const review = asRecord(e.payload.review);
  const list = review && Array.isArray(review.findings) ? review.findings : Array.isArray(e.payload.findings) && typeof e.payload.findings[0] === 'object' ? e.payload.findings : [];
  const out: Array<{ id: string; text: string; linksTo: string | null }> = [];
  for (const raw of list) {
    const f = asRecord(raw) as FindingShape | null;
    const id = f && asStr(f.id);
    const text = f && asStr(f.text);
    if (id && text) out.push({ id, text, linksTo: asStr(f?.linksTo) });
  }
  return out;
}

const normalised = (text: string) =>
  text
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type SkillTheme = { themes: Set<string>; links: Set<string>; texts: Set<string> };

/** What counts as the same mistake again: the evidence findings' themes, links and texts, plus the tags. */
function themeOf(evidenceFindings: Array<{ text: string; linksTo: string | null }>, tags: string[], description: string): SkillTheme {
  const theme: SkillTheme = { themes: new Set(), links: new Set(), texts: new Set() };
  for (const f of evidenceFindings) {
    for (const t of findingThemes({ text: f.text, ...(f.linksTo ? { linksTo: f.linksTo } : {}) })) theme.themes.add(t);
    if (f.linksTo) theme.links.add(f.linksTo.toLowerCase());
    theme.texts.add(normalised(f.text));
  }
  for (const t of tags) theme.themes.add(t.toLowerCase());
  if (evidenceFindings.length === 0) for (const t of findingThemes({ text: description })) theme.themes.add(t);
  return theme;
}

/** A repeat: the same text again, the same risk link, or two or more shared theme words with the evidence. */
export function isRepeatFinding(theme: SkillTheme, f: { text: string; linksTo: string | null }): boolean {
  if (theme.texts.has(normalised(f.text))) return true;
  if (f.linksTo && theme.links.has(f.linksTo.toLowerCase())) return true;
  const words = findingThemes({ text: f.text, ...(f.linksTo ? { linksTo: f.linksTo } : {}) });
  return words.filter((w) => theme.themes.has(w)).length >= 2;
}

type TaskEvents = { task: string; events: StintEvent[] };

async function allTaskEvents(ws: Workspace): Promise<TaskEvents[]> {
  const out: TaskEvents[] = [];
  for (const t of await ws.listTasks()) out.push({ task: t.id, events: await ws.events(t.id).read().catch(() => [] as StintEvent[]) });
  return out;
}

export type SkillTrackBook = {
  tracks: Map<string, SkillTrack>;
  /** skill.retire_proposed payloads already on record, keyed by skill id. */
  retireEvents: Map<string, Array<{ helped: number; hurt: number }>>;
  /** A task timeline that can carry the skill's next event: an evidence task first, then a mounted one. */
  carriers: Map<string, string | null>;
};

const emptyTrack = (): SkillTrack => ({ appliedIn: [], applied: 0, helped: 0, hurt: 0, helpedTasks: [], hurtTasks: [] });

/**
 * Every skill file's and proposal's track record, computed from the event logs: skill.applied
 * says where it mounted, and what followed on that timeline says whether it helped or hurt.
 */
export async function skillTrackBook(ws: Workspace): Promise<SkillTrackBook> {
  const files = scanSkillFiles(ws.root);
  const proposals = await listProposals(ws);
  const byTask = await allTaskEvents(ws);
  const findingsByRef = new Map<string, { text: string; linksTo: string | null }>();
  for (const { task, events } of byTask) {
    for (const e of events) {
      if (e.type !== 'review.recorded') continue;
      const run = e.run ?? asStr(asRecord(e.payload.review)?.run) ?? 'unknown';
      for (const f of findingsOf(e)) findingsByRef.set(`${task}/${run}#${f.id}`, f);
    }
  }
  const subjects = [
    ...files.map((s) => ({ id: s.id, aliases: new Set([s.id, s.frontmatter.name]), evidence: s.frontmatter.evidence ?? [], tags: s.frontmatter.tags ?? [], description: s.frontmatter.description })),
    ...proposals.filter((p) => !files.some((s) => s.id === p.id)).map((p) => ({ id: p.id, aliases: new Set([p.id, p.name]), evidence: p.evidence, tags: p.tags, description: p.description })),
  ];
  const tracks = new Map<string, SkillTrack>();
  const retireEvents = new Map<string, Array<{ helped: number; hurt: number }>>();
  const carriers = new Map<string, string | null>();
  for (const subject of subjects) {
    const evidenceFindings = subject.evidence.map((ref) => findingsByRef.get(ref)).filter((f): f is { text: string; linksTo: string | null } => Boolean(f));
    const theme = themeOf(evidenceFindings, subject.tags, subject.description);
    const track = emptyTrack();
    const appliedIn = new Set<string>();
    const retires: Array<{ helped: number; hurt: number }> = [];
    let carrier: string | null = null;
    for (const ref of subject.evidence) {
      const task = ref.split('/')[0] as string;
      if (byTask.some((t) => t.task === task)) {
        carrier = task;
        break;
      }
    }
    for (const { task, events } of byTask) {
      let firstAppliedSeq = Number.POSITIVE_INFINITY;
      for (const e of events) {
        if (e.type === 'skill.retire_proposed' && asStr(e.payload.id) === subject.id) {
          retires.push({ helped: typeof e.payload.helped === 'number' ? e.payload.helped : 0, hurt: typeof e.payload.hurt === 'number' ? e.payload.hurt : 0 });
        }
        if (e.type !== 'skill.applied') continue;
        const skill = asStr(e.payload.skill);
        if (!skill || !subject.aliases.has(skill)) continue;
        const run = e.run ?? asStr(e.payload.run) ?? 'unknown';
        appliedIn.add(`${task}/${run}`);
        if (e.seq < firstAppliedSeq) firstAppliedSeq = e.seq;
        if (carrier === null) carrier = task;
      }
      if (!Number.isFinite(firstAppliedSeq)) continue;
      const after = events.filter((e) => e.seq >= firstAppliedSeq);
      const repeat = after.filter((e) => e.type === 'review.recorded').flatMap(findingsOf).some((f) => isRepeatFinding(theme, f));
      const approved = after.some((e) => e.type === 'approval.granted');
      const hurtHere = repeat || after.some((e) => e.type === 'approval.rejected' || e.type === 'outcome.reverted');
      if (approved && !repeat) {
        track.helped += 1;
        track.helpedTasks.push(task);
      }
      if (hurtHere) {
        track.hurt += 1;
        track.hurtTasks.push(task);
      }
    }
    track.appliedIn = [...appliedIn].sort();
    track.applied = track.appliedIn.length;
    track.helpedTasks.sort();
    track.hurtTasks.sort();
    tracks.set(subject.id, track);
    retireEvents.set(subject.id, retires);
    carriers.set(subject.id, carrier);
  }
  return { tracks, retireEvents, carriers };
}

type RetireKeep = { id: string; helped: number; hurt: number; at: string };

function retireKeepPath(ws: Workspace): string {
  return join(ws.cacheDir, 'skills-retire-keep.json');
}

async function readRetireKeeps(ws: Workspace): Promise<RetireKeep[]> {
  return (await readJsonIfExists<RetireKeep[]>(retireKeepPath(ws))) ?? [];
}

const evalSideOk = (v: unknown): v is SkillEvalSide => {
  const s = asRecord(v);
  return Boolean(s && ['runs', 'findings', 'passed', 'failed', 'verified', 'inputTokens', 'cachedTokens', 'outputTokens'].every((k) => typeof s[k] === 'number') && (s.usd === null || typeof s.usd === 'number'));
};

/** The eval a `stint eval --skill` run left for this skill, or null when there is none to show. */
export async function readSkillEval(ws: Workspace, id: string): Promise<SkillEvalSummary | null> {
  const raw = asRecord(await readJsonIfExists<unknown>(join(ws.stintDir, 'evals', `${id}.json`)));
  if (!raw || !evalSideOk(raw.with) || !evalSideOk(raw.without)) return null;
  const withSide = raw.with as SkillEvalSide;
  const withoutSide = raw.without as SkillEvalSide;
  return {
    id,
    with: withSide,
    without: withoutSide,
    card: asStr(raw.card) ?? formatSkillEvalCard(withSide, withoutSide),
    ...(asStr(raw.createdAt) ? { createdAt: asStr(raw.createdAt) as string } : {}),
    ...(raw.synthetic === true ? { synthetic: true as const } : {}),
    ...(typeof raw.replay === 'boolean' ? { replay: raw.replay } : {}),
  };
}

/** The registry: skill files plus pending proposals, with consent staleness, the track record and any eval. */
export async function listSkills(ws: Workspace): Promise<SkillRecord[]> {
  const book = await skillTrackBook(ws);
  const keeps = await readRetireKeeps(ws);
  const track = (id: string, status: SkillStatus) => {
    const t = book.tracks.get(id) ?? emptyTrack();
    const kept = keeps.some((k) => k.id === id && k.helped === t.helped && k.hurt === t.hurt);
    const proposed = (book.retireEvents.get(id) ?? []).length > 0;
    return {
      appliedIn: t.appliedIn,
      helped: t.helped,
      hurt: t.hurt,
      retireProposed: proposed && !kept && status !== 'retired' && status !== 'proposed' && t.hurt > t.helped,
    };
  };
  const consent = await readConsent(ws);
  let consentChanged = false;
  const records = new Map<string, SkillRecord>();
  for (const s of scanSkillFiles(ws.root)) {
    const digest = sha256Hex(s.content);
    let stale = false;
    if (consent[s.id] === undefined) {
      // a skill Stint has no digest for records one the first time the registry sees it
      consent[s.id] = digest;
      consentChanged = true;
    } else {
      stale = consent[s.id] !== digest;
    }
    const fm = s.frontmatter;
    records.set(s.id, {
      id: s.id,
      name: fm.name,
      description: fm.description,
      roles: fm.roles ?? [],
      tags: fm.tags ?? [],
      origin: fm.origin,
      status: fm.status,
      evidence: fm.evidence ?? [],
      stale,
      ...track(s.id, fm.status),
    });
  }
  if (consentChanged) await writeJsonAtomic(consentPath(ws), consent);
  for (const p of await listProposals(ws)) {
    if (records.has(p.id)) continue;
    records.set(p.id, {
      id: p.id,
      name: p.name,
      description: p.description,
      roles: p.roles,
      tags: p.tags,
      origin: 'learn-loop',
      status: 'proposed',
      evidence: p.evidence,
      stale: false,
      ...track(p.id, 'proposed'),
    });
  }
  const out = [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const r of out) {
    const summary = await readSkillEval(ws, r.id);
    if (summary) r.eval = summary;
  }
  return out;
}

const yamlList = (items: string[]) => `[${items.map((i) => JSON.stringify(i)).join(', ')}]`;

/** The SKILL.md a proposal becomes on approval: on probation first; the track record earns active (R-031). */
export function renderSkillMarkdown(p: SkillProposal): string {
  return [
    '---',
    `name: ${p.id}`,
    `description: ${JSON.stringify(p.description)}`,
    `roles: ${yamlList(p.roles)}`,
    `tags: ${yamlList(p.tags)}`,
    'version: 1.0.0',
    'origin: learn-loop',
    `evidence: ${yamlList(p.evidence)}`,
    'status: probation',
    '---',
    '',
    `# ${p.name}`,
    '',
    p.rule,
    '',
  ].join('\n');
}

export function renderExamplesMarkdown(p: SkillProposal): string {
  const lines = p.examples.map((e) => `- ${e.task} ${e.run}${e.diff ? `: \`${e.diff}\`` : ''}`);
  return ['# Examples', '', ...(lines.length ? lines : ['No examples.']), ''].join('\n');
}

type SkillEventType = 'skill.approved' | 'skill.rejected' | 'skill.status' | 'skill.retire_proposed' | 'human.command';

/** Skill events live on a task timeline; the first evidence task that exists carries them. */
async function emitSkillEvent(ws: Workspace, evidence: string[], type: SkillEventType, payload: Record<string, unknown>, carrier?: string | null): Promise<void> {
  const candidates = [...evidence.map((ref) => ref.split('/')[0] as string), ...(carrier ? [carrier] : [])];
  for (const task of candidates) {
    try {
      await ws.readTask(task);
    } catch {
      continue;
    }
    await ws.events(task).append({ task, vendor: type === 'skill.status' || type === 'skill.retire_proposed' ? 'daemon' : 'human', type, payload, links: [{ kind: 'skill', ref: String(payload.id) }] });
    return;
  }
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', message: `${type} for skill ${String(payload.id)} was NOT recorded: no task timeline carries it` })}\n`);
}

/** Rewrites only the frontmatter status line; the body and every other field stay byte for byte. */
function withStatus(text: string, status: SkillStatus): string {
  const lines = text.split('\n');
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i] as string)) {
      if (start < 0) start = i;
      else if (lines.slice(start + 1, i).some((l) => l.trim().length > 0)) {
        end = i;
        break;
      } else start = i;
    }
  }
  if (start < 0 || end < 0) throw new Error('SKILL.md has no frontmatter');
  const at = lines.findIndex((l, i) => i > start && i < end && /^status:/.test(l));
  if (at >= 0) lines[at] = `status: ${status}`;
  else lines.splice(end, 0, `status: ${status}`);
  const next = lines.join('\n');
  parseSkillFrontmatter(next);
  return next;
}

/** Commits only the named skill files on the checked out branch, as approval does. A failure is said out loud. */
/**
 * Where else a skill is copied for agents that read their own folder (R-048): `.claude/skills` when a Claude Code
 * agent is enabled. `.agents/skills` stays the one source; the copies follow it in the same commit.
 */
export function skillMirrors(config: Workspace['config']): string[] {
  return config.agents?.['claude-code']?.enabled ? ['.claude/skills'] : [];
}

/** Copies SKILL.md to each mirror, or removes the copy once the skill is retired; returns the paths that changed. */
async function syncMirrors(ws: Workspace, id: string): Promise<string[]> {
  const source = join(skillsDir(ws.root), id, 'SKILL.md');
  const changed: string[] = [];
  for (const mirror of skillMirrors(ws.config)) {
    const rel = `${mirror}/${id}/SKILL.md`;
    const target = join(ws.root, rel);
    const text = existsSync(source) ? readFileSync(source, 'utf8') : null;
    const retired = !text || parseSkillFrontmatter(text).frontmatter.status === 'retired';
    if (retired) {
      if (existsSync(target)) {
        await rm(target, { force: true });
        changed.push(rel);
      }
      continue;
    }
    if (existsSync(target) && readFileSync(target, 'utf8') === text) continue;
    await writeFileAtomic(target, text as string);
    changed.push(rel);
  }
  return changed;
}

async function branchExists(root: string, branch: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`])).code === 0;
}

async function gitEnvOk(root: string, args: string[], env: Record<string, string>): Promise<string> {
  const r = await git(root, args, env);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout;
}

/**
 * Commits the named files onto a branch that is not checked out, by plumbing: a scratch index
 * read from the branch, the files as blobs, one commit, and the ref moved only if it still
 * points where it did. The checked out branch and its index are not touched.
 */
async function commitOntoBranch(ws: Workspace, id: string, files: string[], branch: string, msgFile: string): Promise<string> {
  const root = ws.root;
  const indexFile = join(ws.cacheDir, `skill-${id}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: indexFile } as Record<string, string>;
  try {
    await rm(indexFile, { force: true });
    const parent = (await gitOk(root, ['rev-parse', `refs/heads/${branch}`])).trim();
    await gitEnvOk(root, ['read-tree', `refs/heads/${branch}`], env);
    for (const file of files) {
      if (existsSync(join(root, file))) {
        const blob = (await gitOk(root, ['hash-object', '-w', '--', file])).trim();
        await gitEnvOk(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], env);
      } else {
        await gitEnvOk(root, ['update-index', '--force-remove', '--', file], env);
      }
    }
    const tree = (await gitEnvOk(root, ['write-tree'], env)).trim();
    const commit = (await gitOk(root, [...(await identityArgs(root)), 'commit-tree', tree, '-p', parent, '-F', msgFile])).trim();
    await gitOk(root, ['update-ref', `refs/heads/${branch}`, commit, parent]);
    return commit;
  } finally {
    await rm(indexFile, { force: true });
  }
}

async function commitSkillFiles(ws: Workspace, id: string, files: string[], subject: string): Promise<{ committed: boolean; commit: string | null }> {
  const root = ws.root;
  const checkedOut = (await git(root, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim();
  // the branch the person named in skills.commitTo, or the one checked out in the main tree (R-055)
  const branch = ws.config.skills?.commitTo ?? checkedOut;
  if (!branch) return { committed: false, commit: null };
  if (!(await branchExists(root, branch))) {
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: `skill ${id} files were written but NOT committed: branch ${branch} does not exist` })}\n`);
    return { committed: false, commit: null };
  }
  files = [...files, ...(await syncMirrors(ws, id))];
  const msgFile = join(ws.cacheDir, `skill-${id}.txt`);
  try {
    await mkdir(ws.cacheDir, { recursive: true });
    await writeFileAtomic(msgFile, `${subject}\n\nStint-Skill: ${id}\n`);
    if (branch !== checkedOut) return { committed: true, commit: await commitOntoBranch(ws, id, files, branch, msgFile) };
    await gitOk(root, ['add', '--', ...files]);
    await gitOk(root, [...(await identityArgs(root)), 'commit', '-F', msgFile, '--', ...files]);
    return { committed: true, commit: (await gitOk(root, ['rev-parse', 'HEAD'])).trim() };
  } catch (err) {
    if (branch === checkedOut) await git(root, ['reset', '-q', '--', ...files]);
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: `skill ${id} files were written but NOT committed: ${err instanceof Error ? err.message : String(err)}` })}\n`);
    return { committed: false, commit: null };
  } finally {
    await rm(msgFile, { force: true });
  }
}

/** Writes a status change into SKILL.md, commits it, records consent, and emits skill.status. */
async function applySkillStatus(ws: Workspace, id: string, to: SkillStatus, track: SkillTrack, carrier: string | null): Promise<{ from: SkillStatus; to: SkillStatus } | null> {
  const file = join(skillsDir(ws.root), id, 'SKILL.md');
  if (!existsSync(file)) return null;
  const text = await readFile(file, 'utf8');
  const from = parseSkillFrontmatter(text).frontmatter.status;
  if (from === to) return null;
  const next = withStatus(text, to);
  await writeFileAtomic(file, next);
  const rel = `.agents/skills/${id}/SKILL.md`;
  const { committed, commit } = await commitSkillFiles(ws, id, [rel], `Skill ${id} is now ${to}`);
  await recordConsent(ws, id, next);
  const evidence = parseSkillFrontmatter(next).frontmatter.evidence ?? [];
  await emitSkillEvent(ws, evidence, 'skill.status', { id, from, to, helped: track.helped, hurt: track.hurt, committed, commit }, carrier);
  return { from, to };
}

function checkId(id: string): void {
  if (!SKILL_ID.test(id)) throw new DaemonError('invalid', `${id} is not a skill id`, 'lowercase words joined by dashes');
}

export type ApprovedSkill = SkillRecord & { committed: boolean; commit: string | null; path: string };

/**
 * Approves a pending proposal: writes the skill files, records consent, and commits only those
 * files on `skills.commitTo`, or on the branch checked out in the main tree when that is unset.
 * A named branch that does not exist is refused before anything is written. With no proposal,
 * approving an existing skill records its current file as the consented one, which clears `stale`.
 */
export async function approveSkill(ws: Workspace, id: string, by = 'you'): Promise<ApprovedSkill> {
  checkId(id);
  const root = ws.root;
  const rel = `.agents/skills/${id}/SKILL.md`;
  const proposal = await readProposal(ws, id);
  if (!proposal) {
    const existing = scanSkillFiles(root).find((s) => s.id === id);
    if (!existing) throw new DaemonError('not_found', `no skill or proposal ${id}`);
    await recordConsent(ws, id, existing.content);
    const record = (await listSkills(ws)).find((s) => s.id === id) as SkillRecord;
    return { ...record, committed: false, commit: null, path: rel };
  }
  const commitTo = ws.config.skills?.commitTo;
  if (commitTo && !(await branchExists(root, commitTo))) {
    throw new DaemonError('invalid', `skills.commitTo branch ${commitTo} does not exist`, 'create that branch or fix skills.commitTo in .stint/config.json');
  }
  for (const name of ['SKILL.md', 'examples.md']) {
    if (existsSync(join(skillsDir(root), id, name))) throw new DaemonError('invalid', `.agents/skills/${id}/${name} already exists`, 'retire or rename the existing skill first');
  }
  const dir = join(skillsDir(root), id);
  const skillMd = renderSkillMarkdown(proposal);
  const examplesMd = renderExamplesMarkdown(proposal);
  await writeFileAtomic(join(dir, 'SKILL.md'), skillMd);
  await writeFileAtomic(join(dir, 'examples.md'), examplesMd);

  const { committed, commit } = await commitSkillFiles(ws, id, [rel, `.agents/skills/${id}/examples.md`], `Add skill ${id}`);
  await recordConsent(ws, id, skillMd);
  await rm(join(proposalsDir(ws), `${id}.json`), { force: true });
  await emitSkillEvent(ws, proposal.evidence, 'skill.approved', { id, by, path: rel, committed, commit });
  const record = (await listSkills(ws)).find((s) => s.id === id) as SkillRecord;
  return { ...record, committed, commit, path: rel };
}

/** Rejects a pending proposal and remembers its evidence, so the same evidence never raises it again. */
export async function rejectSkill(ws: Workspace, id: string, reason: string): Promise<{ id: string; rejected: true }> {
  checkId(id);
  const proposal = await readProposal(ws, id);
  if (!proposal) throw new DaemonError('not_found', `no proposal ${id}`);
  await recordRejected(ws, { id, evidenceKey: evidenceKey(proposal.evidence), reason, at: new Date().toISOString() });
  await rm(join(proposalsDir(ws), `${id}.json`), { force: true });
  await emitSkillEvent(ws, proposal.evidence, 'skill.rejected', { id, reason, evidence: proposal.evidence });
  return { id, rejected: true };
}

/**
 * Retires a skill in place: its frontmatter status becomes `retired`, committed like an
 * approval, so nothing mounts it. This is also how a retirement proposal is accepted.
 */
export async function retireSkill(ws: Workspace, id: string): Promise<SkillRecord> {
  checkId(id);
  const file = join(skillsDir(ws.root), id, 'SKILL.md');
  if (!existsSync(file)) throw new DaemonError('not_found', `no skill ${id}`, 'a proposed skill is rejected, not retired');
  const book = await skillTrackBook(ws);
  try {
    await applySkillStatus(ws, id, 'retired', book.tracks.get(id) ?? emptyTrack(), book.carriers.get(id) ?? null);
  } catch {
    throw new DaemonError('invalid', `${relative(ws.root, file)} has no frontmatter to retire`);
  }
  return (await listSkills(ws)).find((s) => s.id === id) as SkillRecord;
}

/** Keeps a skill whose retirement was proposed: the same counts never propose it again. */
export async function keepSkill(ws: Workspace, id: string): Promise<SkillRecord> {
  checkId(id);
  if (!existsSync(join(skillsDir(ws.root), id, 'SKILL.md'))) throw new DaemonError('not_found', `no skill ${id}`);
  const book = await skillTrackBook(ws);
  const track = book.tracks.get(id) ?? emptyTrack();
  const keeps = await readRetireKeeps(ws);
  if (!keeps.some((k) => k.id === id && k.helped === track.helped && k.hurt === track.hurt)) {
    keeps.push({ id, helped: track.helped, hurt: track.hurt, at: new Date().toISOString() });
    await writeJsonAtomic(retireKeepPath(ws), keeps);
  }
  const file = scanSkillFiles(ws.root).find((s) => s.id === id);
  await emitSkillEvent(ws, file?.frontmatter.evidence ?? [], 'human.command', { id, text: `Kept skill ${id}: retirement was proposed and declined.`, helped: track.helped, hurt: track.hurt }, book.carriers.get(id) ?? null);
  return (await listSkills(ws)).find((s) => s.id === id) as SkillRecord;
}

export type SkillStatusChange = { id: string; from: SkillStatus; to: SkillStatus; helped: number; hurt: number };
export type SkillStatusPass = { changed: SkillStatusChange[]; retireProposed: string[] };

/**
 * The one place track records become statuses (R-031): probation with helped >= 3 earns
 * active, and hurt > helped proposes retirement through the queue. Run after every skill
 * approve or reject and every task outcome (approval, rejection, outcome.reverted when a
 * producer lands one), never on a read.
 */
export async function updateSkillStatuses(ctx: DaemonContext): Promise<SkillStatusPass> {
  const ws = ctx.ws;
  const book = await skillTrackBook(ws);
  const keeps = await readRetireKeeps(ws);
  const changed: SkillStatusChange[] = [];
  const retireProposed: string[] = [];
  for (const s of scanSkillFiles(ws.root)) {
    const track = book.tracks.get(s.id) ?? emptyTrack();
    let status = s.frontmatter.status;
    if (status === 'probation' && track.helped >= 3) {
      const applied = await applySkillStatus(ws, s.id, 'active', track, book.carriers.get(s.id) ?? null);
      if (applied) {
        changed.push({ id: s.id, ...applied, helped: track.helped, hurt: track.hurt });
        status = 'active';
      }
    }
    if ((status === 'probation' || status === 'active') && track.hurt > track.helped) {
      const already = (book.retireEvents.get(s.id) ?? []).some((r) => r.helped === track.helped && r.hurt === track.hurt);
      const kept = keeps.some((k) => k.id === s.id && k.helped === track.helped && k.hurt === track.hurt);
      if (!already && !kept) {
        await emitSkillEvent(ws, s.frontmatter.evidence ?? [], 'skill.retire_proposed', { id: s.id, helped: track.helped, hurt: track.hurt }, book.carriers.get(s.id) ?? null);
        retireProposed.push(s.id);
      }
    }
  }
  return { changed, retireProposed };
}
