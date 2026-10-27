import { copyFileSync, existsSync, lstatSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LATEST_MERGED, SECTION_END as END, SECTION_START as START, Workspace, withLatestMerged } from '@stint-dev/core/node';
import { defineCommand } from 'citty';
import { repoRoot } from './repo';

const IGNORES = ['.stint/worktrees/', '.stint/cache/'];

export const SECTION = `${START}
## Stint

This repository is a Stint workspace: tasks live in \`.stint/tasks/<id>/\` as plain JSON and markdown, and only the Stint daemon writes there.

- The active task, when a run is live, is in \`.stint/active\`.
- Read a task's packet (where the last agent got to, what it left out, the ask for you) with \`stint packet <task> --as prompt\`.
- When you make a decision that should not be silently reversed, write it on its own line in your messages as \`decision: <the decision>\`; Stint records it in the task's \`decisions.md\`.
- Stint runs the tests itself after every run; do not push or merge, the person approves through Stint.
- Skills the team approved are in \`.agents/skills/<id>/SKILL.md\`; read the ones that match your task.
${END}`;

/** The context file an agent reads instead of AGENTS.md; each is linked to AGENTS.md once that agent is enabled (R-048). */
export const CONTEXT_FILES: Record<string, string> = { 'claude-code': 'CLAUDE.md', 'gemini-cli': 'GEMINI.md' };

const isLink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Writes the config, the ignore entries, the AGENTS.md section and the links for enabled agents; running it twice
 * changes nothing. A section someone edited by hand (or an older Stint wrote) is kept unless `force` is set; the
 * latest-merged line approve maintains is not an edit and survives a refresh.
 */
export async function init(root: string, { force = false }: { force?: boolean } = {}): Promise<{ changed: string[]; kept: boolean }> {
  const changed: string[] = [];
  const hadConfig = existsSync(join(root, '.stint', 'config.json'));
  const ws = await Workspace.open(root);
  if (!hadConfig) changed.push('.stint/config.json');
  const gi = join(root, '.gitignore');
  const ignore = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const missing = IGNORES.filter((l) => !ignore.split('\n').includes(l));
  if (missing.length) {
    writeFileSync(gi, `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
    changed.push('.gitignore');
  }
  const agents = join(root, 'AGENTS.md');
  const text = existsSync(agents) ? readFileSync(agents, 'utf8') : '';
  const current = new RegExp(`${START}[\\s\\S]*?${END}`).exec(text)?.[0];
  const latest = current ? LATEST_MERGED.exec(current)?.[0] : undefined;
  const fresh = latest ? withLatestMerged(SECTION, latest.trimEnd()) : SECTION;
  const kept = !!current && current.replace(LATEST_MERGED, '') !== SECTION && !force;
  const next = kept
    ? text
    : current
      ? text.replace(current, fresh)
      : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${SECTION}\n`;
  if (next !== text) {
    writeFileSync(agents, next);
    changed.push('AGENTS.md');
  }
  // one source for every agent: a link where symlinks work, a copy where they do not
  for (const [agent, file] of Object.entries(CONTEXT_FILES)) {
    if (!ws.config.agents?.[agent]?.enabled) continue;
    const path = join(root, file);
    if (existsSync(path) || isLink(path)) continue;
    try {
      symlinkSync('AGENTS.md', path);
    } catch {
      copyFileSync(agents, path);
    }
    changed.push(file);
  }
  return { changed, kept };
}

export const initCommand = defineCommand({
  meta: { name: 'init', description: 'Make this repository a Stint workspace' },
  args: {
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    force: { type: 'boolean', description: "Replace AGENTS.md's Stint section even when it was edited by hand" },
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const { changed, kept } = await init(root, { force: args.force });
    process.stdout.write(changed.length ? `Wrote ${changed.join(', ')}\n` : 'Already a Stint workspace; nothing changed.\n');
    if (kept) process.stdout.write("Kept AGENTS.md's Stint section: it differs from this version's text (edited by hand, or written by an older Stint). Run stint init --force to replace it.\n");
    const abs = join(import.meta.dir, '..', '..', 'adapters', 'muse-code', 'plugin');
    // from another repository the relative path climbs to the root, so give the absolute one
    const plugin = relative(process.cwd(), abs).startsWith('..') ? abs : relative(process.cwd(), abs);
    process.stdout.write(`For Muse Code's hooks, install and approve the Stint plugin once:\n  muse plugins install ${plugin} --scope user\n  muse plugins approve stint\n`);
  },
});
