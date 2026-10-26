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
};

const repoArg = { repo: { type: 'string', description: 'Repository root (default: the git top level)' } } as const;

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
    return `${s.id.padEnd(28)} ${s.origin.padEnd(11)} ${s.status.padEnd(9)}${s.stale ? ' stale   ' : '         '}${mount}`;
  });
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

const approve = defineCommand({
  meta: { name: 'approve', description: 'Approve a proposed skill: writes .agents/skills/<id>/SKILL.md and commits it' },
  args: { id: { type: 'positional', required: true, description: 'Skill id' }, ...repoArg },
  async run({ args }) {
    const r = await postDaemon<{ id: string; committed: boolean; commit: string | null; path: string }>(repoRoot(args.repo), `/api/skills/${args.id}/approve`, {});
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
  meta: { name: 'skills', description: 'The skills registry: list, approve or reject what the learn step proposes' },
  subCommands: { list, approve, reject },
});
