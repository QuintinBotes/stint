import { copyFileSync, existsSync, lstatSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { defineCommand } from 'citty';
import { repoRoot } from './repo';

const START = '<!-- stint:start -->';
const END = '<!-- stint:end -->';
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

/** Writes the config, the ignore entries, the AGENTS.md section and the links for enabled agents; running it twice changes nothing. */
export async function init(root: string): Promise<string[]> {
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
  const next = text.includes(START)
    ? text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), SECTION)
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
  return changed;
}

export const initCommand = defineCommand({
  meta: { name: 'init', description: 'Make this repository a Stint workspace' },
  args: { repo: { type: 'string', description: 'Repository root (default: the git top level)' } },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const changed = await init(root);
    process.stdout.write(changed.length ? `Wrote ${changed.join(', ')}\n` : 'Already a Stint workspace; nothing changed.\n');
    const plugin = relative(process.cwd(), join(import.meta.dir, '..', '..', 'adapters', 'muse-code', 'plugin'));
    process.stdout.write(`For Muse Code's hooks, install and approve the Stint plugin once:\n  muse plugins install ${plugin} --scope user\n  muse plugins approve stint\n`);
  },
});
