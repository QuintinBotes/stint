import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type Refusal = { reason: string };

/** Paths that hold credentials: never read or written by an agent, inside the worktree or not. */
const CREDENTIAL_PATH = /(^|\/)(\.env(\.[\w.-]+)?|\.netrc|\.npmrc|id_(rsa|ed25519|ecdsa)(\.pub)?|\.ssh\/.*|\.aws\/.*|\.docker\/config\.json)$/;

/** Shell commands Stint refuses, each with the reason the agent is told. Each is matched against one part of a chain. */
const COMMAND_RULES: Array<[RegExp, string]> = [
  [/\bgit\s+push\b/, 'pushing is the human\'s call; Stint merges on approve'],
  [/\bgit\s+reset\s+--hard\b/, 'a hard reset can destroy work; Stint commits the worktree when the run ends'],
  [/\bgit\s+(checkout|switch)\s+(?!--\s)(-[bBc]\s+)?[\w./-]+\s*$/, 'the run stays on its task branch'],
  [/\bgit\s+(rebase|filter-branch|filter-repo|update-ref)\b/, 'history rewrites are not part of a task run'],
  [/\bgit\s+remote\s+(add|set-url|remove|rm|rename)\b/, 'remotes are the person\'s to change'],
  [/\bgit\s+branch\s+(-[dDmM]|--delete|--move)\b/, 'other branches are not part of a task run'],
  [/\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(\/|~|\$HOME|\.\.)/, 'deleting outside the worktree'],
  [/\bsudo\b/, 'no elevated privileges'],
  [/\bcurl\b[^|;&]*\s(-T|--upload-file|-F|--form|--data-binary\s+@)/, 'uploading files off the machine'],
  [/\b(scp|sftp)\b/, 'copying files to another host'],
  [/\brsync\b[^|;&]*\s[\w.-]+@?[\w.-]+:/, 'copying files to another host'],
  [/(~|\$HOME)\/\.(ssh|aws|docker|netrc|npmrc)/, 'credential paths are off limits'],
  [/(^|[\s'"/])\.env(\.[\w.-]+)?(\s|$|['"])/, 'credential files are off limits'],
];

/** Read-only places a build may name outside the worktree: devices and the system's own programs. */
const SYSTEM_PATH = /^\/(dev\/(null|stdout|stderr|stdin|tty|zero|u?random)$|(bin|sbin|usr\/bin|usr\/sbin|usr\/local\/bin|opt\/homebrew\/bin)\/[^/]+$)/;

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** The path with its symlinks resolved, or, when it does not exist yet, its nearest existing parent resolved plus the rest. */
function resolveLinks(p: string): string {
  let head = p;
  const tail: string[] = [];
  while (!existsSync(head) && dirname(head) !== head) {
    tail.unshift(head.slice(dirname(head).length + 1));
    head = dirname(head);
  }
  return [real(head), ...tail].join(sep);
}

const inside = (root: string, p: string) => p === root || p.startsWith(root + sep);

/** The worktree-relative form of `p`, or a refusal when it leaves the worktree (symlinks followed) or names a credential file. */
export function checkPath(worktree: string, p: unknown): { path: string } | Refusal {
  if (typeof p !== 'string' || p.length === 0) return { reason: 'a path is required' };
  const full = resolve(worktree, p);
  const rel = relative(worktree, full);
  if (rel.startsWith('..') || isAbsolute(rel) || (rel !== '' && !full.startsWith(worktree + sep) && full !== worktree)) {
    return { reason: `${p} is outside the worktree` };
  }
  // a link inside the worktree must not lead out of it
  if (!inside(resolveLinks(worktree), resolveLinks(full))) return { reason: `${p} leads outside the worktree through a link` };
  if (rel.split(sep).includes('.git')) return { reason: 'the .git folder belongs to Stint' };
  if (CREDENTIAL_PATH.test(rel)) return { reason: `${p} is a credential file` };
  return { path: rel || '.' };
}

/**
 * The parts of a shell command that run on their own: split on `&&`, `||`, `;`, `|`, `&`, newlines, and the
 * insides of `$( )` and backticks. Splitting errs toward more parts: a quoted operator splits an argument, which
 * can only add a refusal, never remove one.
 */
export function commandParts(command: string): string[] {
  return command
    .replace(/\$\(|`|\)/g, '\n')
    .split(/&&|\|\||[;|&\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `git` with its global options taken out, so `git -C . push` reads as `git push`; the options are returned to be checked. */
function gitParts(part: string): { command: string; dirs: string[] } {
  const m = /^((?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)git\s+(.*)$/.exec(part);
  if (!m) return { command: part, dirs: [] };
  const words = (m[2] ?? '').split(/\s+/);
  const dirs: string[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i] as string;
    if (w === '-C' || w === '--git-dir' || w === '--work-tree') {
      dirs.push(words[i + 1] ?? '');
      i += 2;
    } else if (w.startsWith('--git-dir=') || w.startsWith('--work-tree=')) {
      dirs.push(w.slice(w.indexOf('=') + 1));
      i += 1;
    } else if (w === '-c' || w === '--namespace' || w === '--exec-path') i += 2;
    else if (w.startsWith('-')) i += 1;
    else break;
  }
  return { command: `git ${words.slice(i).join(' ')}`, dirs };
}

/** The unquoted words of a part; quoted ones are patterns and messages far more often than paths. */
function pathWords(part: string): string[] {
  return part
    .replace(/'[^']*'|"[^"]*"/g, ' ')
    .split(/\s+|[<>=]/)
    .filter(Boolean);
}

/**
 * True when `word`, taken as a path from the worktree with links followed, lands outside it on something that exists
 * or on a new file in an existing folder other than `/`. Words that are not paths resolve inside and pass.
 */
function leaves(worktree: string, word: string, tmp: string | undefined): boolean {
  const expanded = word.replace(/^(~|\$HOME)(?=\/|$)/, process.env.HOME ?? '/home');
  const full = resolve(worktree, expanded);
  if (SYSTEM_PATH.test(full)) return false;
  if (tmp && inside(resolveLinks(tmp), resolveLinks(full))) return false;
  if (inside(resolveLinks(worktree), resolveLinks(full))) return false;
  const parent = dirname(full);
  return existsSync(full) || (parent !== '/' && existsSync(parent));
}

/**
 * A refusal for a shell command, or null. Every part of a chain is checked; git's global options cannot hide a
 * subcommand; and with the worktree given, a part may not name a path outside it (devices, system programs and the
 * run's temp folder excepted). This is the second line behind the sandbox (R-040), not a replacement for it.
 */
export function checkCommand(command: unknown, worktree?: string, tmp?: string): Refusal | null {
  if (typeof command !== 'string' || command.trim() === '') return { reason: 'a command is required' };
  for (const part of commandParts(command)) {
    const git = gitParts(part);
    for (const [rule, reason] of COMMAND_RULES) if (rule.test(part) || rule.test(git.command)) return { reason };
    if (!worktree) continue;
    for (const dir of git.dirs) {
      if (!inside(resolveLinks(worktree), resolveLinks(resolve(worktree, dir)))) return { reason: `git runs in the worktree only, not ${dir}` };
    }
    for (const word of pathWords(part)) {
      if (leaves(worktree, word, tmp)) return { reason: `${word} is outside the worktree` };
    }
  }
  return null;
}
