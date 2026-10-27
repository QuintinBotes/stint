import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { type SkillBundleFile, type SkillFinding, type SkillSource, validateSkillBundle } from '@stint-dev/core';
import { defineCommand } from 'citty';
import { daemonFor, postDaemon } from './client';
import { repoRoot } from './repo';

type SkillRow = {
  id: string;
  name: string;
  description: string;
  roles: string[];
  tags: string[];
  origin: string;
  status: string;
  evidence: string[];
  stale: boolean;
  appliedIn: string[];
  helped: number;
  hurt: number;
  retireProposed: boolean;
  updateProposed?: boolean;
};

type ImportResult = { id: string; proposal: SkillRow & { digest?: string }; findings: SkillFinding[] };

const repoArg = { repo: { type: 'string', description: 'Repository root (default: the git top level)' } } as const;
const rolesArg = { roles: { type: 'string', description: 'Roles the skill mounts for, comma separated (planner, implementer, reviewer)' } } as const;
const tagsArg = { tags: { type: 'string', description: 'Tags the skill mounts on, comma separated' } } as const;

const commaList = (value: string | undefined): string[] | undefined => {
  const list = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
};

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const printFindings = (findings: SkillFinding[]) => {
  if (!findings.length) process.stdout.write('The scan found nothing to flag. Scanned by pattern; this is not a security review.\n');
  for (const f of findings) process.stdout.write(`${f.severity} ${f.id} ${f.file}${f.line ? `:${f.line}` : ''}: ${f.text}\n`);
  if (findings.length) process.stdout.write('Scanned by pattern; this is not a security review.\n');
};

/** The registry as the daemon sees it; the CLI never writes `.stint/` itself. */
async function listFromDaemon(root: string): Promise<SkillRow[]> {
  const d = daemonFor(root);
  const res = await fetch(`${d.url}/api/skills`);
  if (!res.ok) {
    process.stderr.write(`the daemon refused the skills list (HTTP ${res.status})\n`);
    process.exit(1);
  }
  return (await res.json()) as SkillRow[];
}

export function formatSkills(rows: SkillRow[]): string[] {
  if (rows.length === 0) return ['No skills yet.'];
  return rows.map((s) => {
    const mount = [s.roles.length ? `roles: ${s.roles.join(', ')}` : 'roles: all', s.tags.length ? `tags: ${s.tags.join(', ')}` : 'tags: all'].join('; ');
    const track = `applied ${s.appliedIn.length}, helped ${s.helped}, hurt ${s.hurt}${s.retireProposed ? ', retirement proposed' : ''}`;
    return `${s.id.padEnd(28)} ${s.origin.padEnd(11)} ${s.status.padEnd(9)}${s.stale ? ' stale   ' : '         '}${mount}; ${track}`;
  });
}

type DaemonFailure = { error?: { code: string; message: string; hint?: { findings?: SkillFinding[]; acknowledge?: string[] } | string | null } };

async function postImport(root: string, init: { json?: unknown; form?: FormData }): Promise<ImportResult> {
  const d = daemonFor(root);
  const res = init.form
    ? await fetch(`${d.url}/api/skills/import`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}` }, body: init.form })
    : await fetch(`${d.url}/api/skills/import`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(init.json) });
  const body = (await res.json()) as ImportResult & DaemonFailure;
  if (!res.ok) {
    const hint = body.error?.hint;
    const findings = hint && typeof hint === 'object' ? hint.findings : undefined;
    process.stderr.write(`${body.error?.code ?? res.status}: ${body.error?.message ?? 'the daemon refused the import'}\n`);
    if (findings) printFindings(findings);
    process.exit(1);
  }
  return body;
}

/** Posts a bundle as files. The CLI validates as a courtesy first; the daemon is the gate. */
async function submitFiles(root: string, files: SkillBundleFile[], source: SkillSource, opts: { id?: string; roles?: string[]; tags?: string[] }): Promise<ImportResult> {
  const check = validateSkillBundle(files);
  if (!check.ok) {
    printFindings(check.findings);
    fail('This bundle does not validate yet, so nothing was sent. Fix the findings above and add it again.');
  }
  return postImport(root, {
    json: {
      files: check.files.map((f) => ({ path: f.path, base64: Buffer.from(f.bytes).toString('base64'), ...(f.mode !== undefined ? { mode: f.mode } : {}) })),
      source,
      ...(opts.id ? { id: opts.id } : {}),
      ...(opts.roles ? { roles: opts.roles } : {}),
      ...(opts.tags ? { tags: opts.tags } : {}),
    },
  });
}

function folderFiles(base: string): SkillBundleFile[] {
  const out: SkillBundleFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push({ path: relative(base, full).split('\\').join('/'), bytes: readFileSync(full), mode: lstatSync(full).mode });
    }
  };
  walk(base);
  return out;
}

function gitAway(args: string[], cwd?: string): { ok: boolean; out: string } {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { ok: r.exitCode === 0, out: `${r.stdout.toString()}${r.stderr.toString()}`.trim() };
}

type GitSource = { url: string; ref?: string; subpath?: string };

/** Splits a git source of the form `<url>#<ref>:<subpath>`; the ref and the subpath are both optional. */
export function parseGitSource(source: string): GitSource {
  const at = source.indexOf('#');
  if (at < 0) return { url: source };
  const rest = source.slice(at + 1);
  const colon = rest.indexOf(':');
  const ref = colon >= 0 ? rest.slice(0, colon) : rest;
  const subpath = colon >= 0 ? rest.slice(colon + 1) : undefined;
  return { url: source.slice(0, at), ...(ref ? { ref } : {}), ...(subpath ? { subpath } : {}) };
}

const isGitSource = (source: string) => source.startsWith('https://') || source.startsWith('git@') || source.startsWith('file://');

function bundleFromDiskRoot(base: string, label: string): SkillBundleFile[] {
  if (!existsSync(base)) fail(`No folder at ${label}. Check the path and try again.`);
  if (statSync(base).isFile()) {
    if (basename(base) !== 'SKILL.md') fail(`${label} is a file but not a SKILL.md. Pass the folder that holds it, the SKILL.md itself, a zip, or a git URL.`);
    return [{ path: 'SKILL.md', bytes: readFileSync(base), mode: lstatSync(base).mode }];
  }
  return folderFiles(base);
}

async function addGit(root: string, given: string, opts: { id?: string; roles?: string[]; tags?: string[] }): Promise<ImportResult> {
  const { url, ref, subpath } = parseGitSource(given);
  if (subpath && (subpath.startsWith('/') || subpath.split('/').includes('..'))) fail(`The path ${subpath} reaches outside the clone. Use a path inside the repository.`);
  const dir = mkdtempSync(join(tmpdir(), 'stint-skill-git-'));
  try {
    const cloned = gitAway(['clone', '-q', '--depth', '1', url, dir]);
    if (!cloned.ok) fail(`Cloning ${url} did not work: ${cloned.out.split('\n').at(-1) ?? ''}. Check the URL and try again.`);
    if (ref) {
      const fetched = gitAway(['-C', dir, 'fetch', '-q', '--depth', '1', 'origin', ref]);
      const checked = fetched.ok ? gitAway(['-C', dir, 'checkout', '-q', 'FETCH_HEAD']) : gitAway(['-C', dir, 'checkout', '-q', ref]);
      if (!checked.ok) fail(`The clone has no ref ${ref}. Check the ref after the # and add it again.`);
    }
    const commit = gitAway(['-C', dir, 'rev-parse', 'HEAD']).out.split('\n')[0] ?? '';
    const base = subpath ? join(dir, subpath) : dir;
    const files = bundleFromDiskRoot(base, subpath ? `${url}:${subpath}` : url);
    return await submitFiles(root, files, { kind: 'git', ref: given, ...(commit ? { commit } : {}) }, opts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const list = defineCommand({
  meta: { name: 'list', description: 'Skills and pending proposals, with their origin and status' },
  args: { json: { type: 'boolean', description: 'Machine-readable output' }, ...repoArg },
  async run({ args }) {
    const rows = await listFromDaemon(repoRoot(args.repo));
    if (args.json) {
      process.stdout.write(`${JSON.stringify(rows)}\n`);
      return;
    }
    for (const line of formatSkills(rows)) process.stdout.write(`${line}\n`);
  },
});

const add = defineCommand({
  meta: { name: 'add', description: 'Bring a skill in from a folder, a SKILL.md, a zip or a git URL; it waits in the review queue' },
  args: {
    source: { type: 'positional', required: true, description: 'A folder, a SKILL.md, a .zip, or a git URL with an optional #ref:subpath' },
    id: { type: 'string', description: 'Queue it under this skill id instead of the name in its frontmatter' },
    json: { type: 'boolean', description: 'Machine-readable output' },
    ...rolesArg,
    ...tagsArg,
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const opts = { ...(args.id ? { id: args.id } : {}), ...(commaList(args.roles) ? { roles: commaList(args.roles) } : {}), ...(commaList(args.tags) ? { tags: commaList(args.tags) } : {}) };
    const given = args.source;
    const onDisk = existsSync(given) ? resolve(given) : null;
    let result: ImportResult;
    if (onDisk && statSync(onDisk).isFile() && onDisk.toLowerCase().endsWith('.zip')) {
      const form = new FormData();
      form.append('file', new File([readFileSync(onDisk)], basename(onDisk), { type: 'application/zip' }));
      form.append('source', JSON.stringify({ kind: 'zip', ref: given } satisfies SkillSource));
      if (opts.id) form.append('id', opts.id);
      if (opts.roles) form.append('roles', JSON.stringify(opts.roles));
      if (opts.tags) form.append('tags', JSON.stringify(opts.tags));
      result = await postImport(root, { form });
    } else if (onDisk) {
      result = await submitFiles(root, bundleFromDiskRoot(onDisk, given), { kind: 'folder', ref: given }, opts);
    } else if (isGitSource(given)) {
      result = await addGit(root, given, opts);
    } else {
      result = fail(`Nothing at ${given}, and it is not a git URL either. Pass a folder, a SKILL.md, a .zip, or a git URL (https://, git@ or file://, with an optional #ref:subpath).`);
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    process.stdout.write(result.proposal.updateProposed ? `Queued an update for ${result.id} for review. The approved skill keeps mounting until the update is approved.\n` : `Queued ${result.id} for review. It mounts once it is approved, on probation first.\n`);
    printFindings(result.findings);
    const warns = [...new Set(result.findings.filter((f) => f.severity === 'warn').map((f) => f.id))];
    const blocked = result.findings.some((f) => f.severity === 'block');
    process.stdout.write(blocked ? `The scan blocks approval. Fix the block findings, then add it again.\n` : warns.length ? `Approve it with: stint skills approve ${result.id} --ack ${warns.join(',')}\n` : `Approve it with: stint skills approve ${result.id}\n`);
  },
});

const newSkill = defineCommand({
  meta: { name: 'new', description: 'Write a skill here and put it in the review queue' },
  args: {
    id: { type: 'positional', required: true, description: 'Skill id: lowercase words joined by dashes' },
    description: { type: 'string', required: true, description: 'When an agent should use it; this is the line every agent reads' },
    'from-file': { type: 'string', description: 'Read the body from this markdown file' },
    json: { type: 'boolean', description: 'Machine-readable output' },
    ...rolesArg,
    ...tagsArg,
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const fromFile = args['from-file'];
    const body = fromFile ? readFileSync(resolve(fromFile), 'utf8').trim() : 'Write the rule here, from a real failure: what went wrong, and what to do instead. Keep the body under 5,000 tokens and put detail in references/.';
    const list = (items: string[] | undefined) => `[${(items ?? []).map((i) => JSON.stringify(i)).join(', ')}]`;
    const skillMd = [
      '---',
      `name: ${args.id}`,
      `description: ${JSON.stringify(args.description)}`,
      `roles: ${list(commaList(args.roles))}`,
      `tags: ${list(commaList(args.tags))}`,
      'origin: human',
      `source: ${JSON.stringify({ kind: 'editor', ref: 'stint skills new' })}`,
      '---',
      '',
      `# ${args.id}`,
      '',
      body,
      '',
    ].join('\n');
    const result = await submitFiles(root, [{ path: 'SKILL.md', bytes: new TextEncoder().encode(skillMd) }], { kind: 'editor', ref: 'stint skills new' }, { id: args.id });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    process.stdout.write(`Queued ${result.id} for review. It mounts once it is approved, on probation first.\n`);
    printFindings(result.findings);
  },
});

const exportSkill = defineCommand({
  meta: { name: 'export', description: 'Write an approved skill out as a zip, to share it' },
  args: { id: { type: 'positional', required: true, description: 'Skill id' }, out: { type: 'string', description: 'Where the zip goes (default: ./<id>.zip)' }, ...repoArg },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const d = daemonFor(root);
    const res = await fetch(`${d.url}/api/skills/${args.id}/export`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as DaemonFailure;
      fail(`${body.error?.code ?? res.status}: ${body.error?.message ?? `the daemon answered ${res.status}`}`);
    }
    const out = resolve(args.out ?? `${args.id}.zip`);
    await writeFile(out, new Uint8Array(await (res as Response).arrayBuffer()));
    process.stdout.write(`Wrote ${out}. The other side adds it with: stint skills add ${basename(out)}\n`);
  },
});

const approve = defineCommand({
  meta: { name: 'approve', description: 'Approve a proposed skill: writes .agents/skills/<id>/ and commits it' },
  args: { id: { type: 'positional', required: true, description: 'Skill id' }, ack: { type: 'string', description: 'Warning ids you have read and accept, comma separated' }, ...repoArg },
  async run({ args }) {
    const acknowledge = commaList(args.ack);
    const r = await postDaemon<{ id: string; committed: boolean; commit: string | null; path: string }>(repoRoot(args.repo), `/api/skills/${args.id}/approve`, acknowledge ? { acknowledge } : {});
    process.stdout.write(r.committed ? `Approved ${r.id}: ${r.path} committed as ${(r.commit ?? '').slice(0, 12)}.\n` : `Approved ${r.id}: ${r.path} written, not committed.\n`);
  },
});

const reject = defineCommand({
  meta: { name: 'reject', description: 'Reject a proposed skill; the same evidence does not raise it again' },
  args: { id: { type: 'positional', required: true, description: 'Skill id' }, reason: { type: 'string', required: true, description: 'Why it is rejected' }, ...repoArg },
  async run({ args }) {
    await postDaemon<{ id: string }>(repoRoot(args.repo), `/api/skills/${args.id}/reject`, { reason: args.reason });
    process.stdout.write(`Rejected ${args.id}: ${args.reason}. The same evidence will not raise it again.\n`);
  },
});

export const skills = defineCommand({
  meta: { name: 'skills', description: 'The skills registry: list, add, write, export, approve or reject skills' },
  subCommands: { list, add, new: newSkill, export: exportSkill, approve, reject },
});
