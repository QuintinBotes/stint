import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { type Role, type SkillProposal, SkillProposalSchema, parseSkillFrontmatter } from '@stint-dev/core';
import { type Workspace, canonicalJSON, readJsonIfExists, sha256Hex, skillsHelped, writeFileAtomic, writeJsonAtomic } from '@stint-dev/core/node';
import { DaemonError } from './errors';
import { git, gitOk, identityArgs } from './git';
import type { MountedSkill } from './prompt';

export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  roles: Role[];
  tags: string[];
  origin: 'human' | 'learn-loop';
  status: 'active' | 'proposed' | 'retired';
  evidence: string[];
  stale: boolean;
  appliedIn: string[];
  helped: number;
  hurt: number;
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

/**
 * Active skills in `.agents/skills` that apply to a role. A skill without roles applies to every
 * role; a skill without tags applies to every task. When `tags` is given, a tagged skill mounts
 * only when one of its tags is one of the task's tags.
 */
export function skillsFor(root: string, role: Role, tags?: string[]): MountedSkill[] {
  const out: MountedSkill[] = [];
  for (const s of scanSkillFiles(root)) {
    const fm = s.frontmatter;
    if (fm.status !== 'active') continue;
    if (fm.roles && !fm.roles.includes(role)) continue;
    if (tags && fm.tags && fm.tags.length > 0 && !fm.tags.some((t) => tags.includes(t))) continue;
    out.push({ name: fm.name, description: fm.description });
  }
  return out;
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

/** The registry: skill files plus pending proposals, with consent staleness and the graph track record. */
export async function listSkills(ws: Workspace): Promise<SkillRecord[]> {
  const helped = await skillsHelped(ws);
  const track = (id: string, name: string) => {
    const rows = helped.filter((r) => r.skill === id || r.skill === name);
    return {
      appliedIn: [...new Set(rows.flatMap((r) => r.appliedIn))].sort(),
      helped: rows.reduce((s, r) => s + r.approvedAfter, 0),
      hurt: rows.reduce((s, r) => s + r.hurt, 0),
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
      ...track(s.id, fm.name),
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
      ...track(p.id, p.name),
    });
  }
  return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const yamlList = (items: string[]) => `[${items.map((i) => JSON.stringify(i)).join(', ')}]`;

/** The SKILL.md a proposal becomes on approval: the rule verbatim under the proposal's name. */
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
    'status: active',
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

/** Skill events live on a task timeline; the first evidence task that exists carries them. */
async function emitSkillEvent(ws: Workspace, evidence: string[], type: 'skill.approved' | 'skill.rejected', payload: Record<string, unknown>): Promise<void> {
  for (const ref of evidence) {
    const task = ref.split('/')[0] as string;
    try {
      await ws.readTask(task);
    } catch {
      continue;
    }
    await ws.events(task).append({ task, vendor: 'human', type, payload, links: [{ kind: 'skill', ref: String(payload.id) }] });
    return;
  }
}

function checkId(id: string): void {
  if (!SKILL_ID.test(id)) throw new DaemonError('invalid', `${id} is not a skill id`, 'lowercase words joined by dashes');
}

export type ApprovedSkill = SkillRecord & { committed: boolean; commit: string | null; path: string };

/**
 * Approves a pending proposal: writes the skill files, records consent, and commits only those
 * files on the branch checked out in the main tree. With no proposal, approving an existing
 * skill records its current file as the consented one, which clears `stale`.
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
  for (const name of ['SKILL.md', 'examples.md']) {
    if (existsSync(join(skillsDir(root), id, name))) throw new DaemonError('invalid', `.agents/skills/${id}/${name} already exists`, 'retire or rename the existing skill first');
  }
  const dir = join(skillsDir(root), id);
  const skillMd = renderSkillMarkdown(proposal);
  const examplesMd = renderExamplesMarkdown(proposal);
  await writeFileAtomic(join(dir, 'SKILL.md'), skillMd);
  await writeFileAtomic(join(dir, 'examples.md'), examplesMd);

  let committed = false;
  let commit: string | null = null;
  const branch = (await git(root, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim();
  if (branch) {
    const msgFile = join(ws.cacheDir, `skill-${id}.txt`);
    try {
      const files = [rel, `.agents/skills/${id}/examples.md`];
      await mkdir(ws.cacheDir, { recursive: true });
      await writeFileAtomic(msgFile, `Add skill ${id}\n\nStint-Skill: ${id}\n`);
      await gitOk(root, ['add', '--', ...files]);
      await gitOk(root, [...(await identityArgs(root)), 'commit', '-F', msgFile, '--', ...files]);
      commit = (await gitOk(root, ['rev-parse', 'HEAD'])).trim();
      committed = true;
    } catch (err) {
      // unstage, so the skill files do not ride along in the person's next commit
      await git(root, ['reset', '-q', '--', rel, `.agents/skills/${id}/examples.md`]);
      process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: `skill ${id} was written but NOT committed: ${err instanceof Error ? err.message : String(err)}` })}\n`);
    } finally {
      await rm(msgFile, { force: true });
    }
  }
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

/** Retires an active skill in place: its frontmatter status becomes `retired`, so nothing mounts it. */
export async function retireSkill(ws: Workspace, id: string): Promise<SkillRecord> {
  checkId(id);
  const file = join(skillsDir(ws.root), id, 'SKILL.md');
  if (!existsSync(file)) throw new DaemonError('not_found', `no skill ${id}`, 'a proposed skill is rejected, not retired');
  const text = await readFile(file, 'utf8');
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
  if (start < 0 || end < 0) throw new DaemonError('invalid', `${relative(ws.root, file)} has no frontmatter to retire`);
  const at = lines.findIndex((l, i) => i > start && i < end && /^status:/.test(l));
  if (at >= 0) lines[at] = 'status: retired';
  else lines.splice(end, 0, 'status: retired');
  const next = lines.join('\n');
  parseSkillFrontmatter(next);
  await writeFileAtomic(file, next);
  await recordConsent(ws, id, next);
  return (await listSkills(ws)).find((s) => s.id === id) as SkillRecord;
}
