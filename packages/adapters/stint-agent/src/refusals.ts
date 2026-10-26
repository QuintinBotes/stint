import { isAbsolute, relative, resolve, sep } from 'node:path';

export type Refusal = { reason: string };

/** Paths that hold credentials: never read or written by an agent, inside the worktree or not. */
const CREDENTIAL_PATH = /(^|\/)(\.env(\.[\w.-]+)?|\.netrc|\.npmrc|id_(rsa|ed25519|ecdsa)(\.pub)?|\.ssh\/.*|\.aws\/.*|\.docker\/config\.json)$/;

/** Shell commands Stint refuses, each with the reason the agent is told. */
const COMMAND_RULES: Array<[RegExp, string]> = [
  [/\bgit\s+push\b/, 'pushing is the human\'s call; Stint merges on approve'],
  [/\bgit\s+reset\s+--hard\b/, 'a hard reset can destroy work; Stint commits the worktree when the run ends'],
  [/\bgit\s+(checkout|switch)\s+(?!--\s)(-[bBc]\s+)?[\w./-]+\s*$/, 'the run stays on its task branch'],
  [/\bgit\s+(rebase|filter-branch|filter-repo|update-ref)\b/, 'history rewrites are not part of a task run'],
  [/\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(\/|~|\$HOME|\.\.)/, 'deleting outside the worktree'],
  [/\bsudo\b/, 'no elevated privileges'],
  [/\bcurl\b[^|;&]*\s(-T|--upload-file|-F|--form|--data-binary\s+@)/, 'uploading files off the machine'],
  [/\b(scp|sftp)\b/, 'copying files to another host'],
  [/\brsync\b[^|;&]*\s[\w.-]+@?[\w.-]+:/, 'copying files to another host'],
  [/(~|\$HOME)\/\.(ssh|aws|docker|netrc|npmrc)/, 'credential paths are off limits'],
  [/(^|[\s'"/])\.env(\.[\w.-]+)?(\s|$|['"])/, 'credential files are off limits'],
];

/** The worktree-relative form of `p`, or a refusal when it leaves the worktree or names a credential file. */
export function checkPath(worktree: string, p: unknown): { path: string } | Refusal {
  if (typeof p !== 'string' || p.length === 0) return { reason: 'a path is required' };
  const full = resolve(worktree, p);
  const rel = relative(worktree, full);
  if (rel.startsWith('..') || isAbsolute(rel) || (rel !== '' && !full.startsWith(worktree + sep) && full !== worktree)) {
    return { reason: `${p} is outside the worktree` };
  }
  if (rel.split(sep).includes('.git')) return { reason: 'the .git folder belongs to Stint' };
  if (CREDENTIAL_PATH.test(rel)) return { reason: `${p} is a credential file` };
  return { path: rel || '.' };
}

export function checkCommand(command: unknown): Refusal | null {
  if (typeof command !== 'string' || command.trim() === '') return { reason: 'a command is required' };
  for (const [rule, reason] of COMMAND_RULES) if (rule.test(command)) return { reason };
  return null;
}
