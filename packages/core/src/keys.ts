// Where Stint finds its keys, wherever `stint` runs. Bun loads `.env` only from the current folder, so a key kept in
// the Stint checkout never reached a person's own repository; this is the one loader the CLI and the daemon share.
// Values never reach a log, an event or the UI: only names and sources do.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_CONFIG } from './schemas/config';

export type KeySource = 'env' | 'repo' | 'user' | 'checkout' | 'missing';

/** The Stint checkout this code runs from: packages/core/src is three folders below it. */
export const STINT_CHECKOUT = resolve(import.meta.dir, '..', '..', '..');

/** The user-level key file: `$XDG_CONFIG_HOME/stint/env`, else `~/.config/stint/env`. */
export function userKeyFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'stint', 'env');
}

/** `NAME=value` lines; `export ` and matching quotes are allowed, `#` starts a comment line. */
export function parseKeyFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && value) out[name] = value;
  }
  return out;
}

function namesFrom(config: unknown): string[] {
  const c = (config ?? {}) as { hosts?: Record<string, { keyEnv?: string; baseURLEnv?: string }>; agents?: Record<string, { env?: string[] }> };
  return [
    ...Object.values(c.hosts ?? {}).flatMap((h) => [h.keyEnv, h.baseURLEnv]),
    ...Object.values(c.agents ?? {}).flatMap((a) => a.env ?? []),
  ].filter((n): n is string => typeof n === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
}

/** Every key Stint knows: each host's key and address variables and each agent's variables, in the defaults and the repository's config. */
export function knownKeyNames(repoRoot: string): string[] {
  let repoConfig: unknown = null;
  try {
    repoConfig = JSON.parse(readFileSync(join(repoRoot, '.stint', 'config.json'), 'utf8'));
  } catch {
    // no config yet, or not valid JSON: the defaults name the keys
  }
  return [...new Set([...namesFrom(DEFAULT_CONFIG), ...namesFrom(repoConfig)])].sort();
}

const git = (cwd: string, args: string[]) => spawnSync('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).status === 0;

/**
 * Loads each known key, first found wins: the process environment, `<repo>/.env` (only when git ignores it), the
 * user-level file, then `<checkout>/.env` for people who followed the old instructions. A tracked or unignored repo
 * `.env` is refused and never read; a user-level file others can read is warned about.
 */
export function loadKeys(
  repoRoot: string,
  opts: { checkout?: string; env?: NodeJS.ProcessEnv } = {},
): { values: Record<string, string>; sources: Record<string, KeySource>; refusals: string[] } {
  const env = opts.env ?? process.env;
  const checkout = resolve(opts.checkout ?? STINT_CHECKOUT);
  const names = knownKeyNames(repoRoot);
  const refusals: string[] = [];

  let repoKeys: Record<string, string> = {};
  const repoEnv = join(repoRoot, '.env');
  if (existsSync(repoEnv)) {
    const tracked = git(repoRoot, ['ls-files', '--error-unmatch', '.env']);
    const ignored = !tracked && git(repoRoot, ['check-ignore', '-q', '.env']);
    if (ignored) repoKeys = parseKeyFile(readFileSync(repoEnv, 'utf8'));
    else {
      const why = tracked ? 'tracked by git' : 'not ignored by git';
      refusals.push(`${repoEnv} is ${why}, so Stint did not read it; add .env to .gitignore${tracked ? ' and run git rm --cached .env' : ''}`);
    }
  }

  let userKeys: Record<string, string> = {};
  const userFile = userKeyFile(env);
  if (existsSync(userFile)) {
    userKeys = parseKeyFile(readFileSync(userFile, 'utf8'));
    const mode = statSync(userFile).mode & 0o777;
    if (mode & 0o077) process.stderr.write(`stint: ${userFile} can be read by others (mode ${mode.toString(8)}); run chmod 600 ${userFile}\n`);
  }

  let checkoutKeys: Record<string, string> = {};
  const checkoutEnv = join(checkout, '.env');
  if (checkout !== resolve(repoRoot) && existsSync(checkoutEnv)) checkoutKeys = parseKeyFile(readFileSync(checkoutEnv, 'utf8'));

  const values: Record<string, string> = {};
  const sources: Record<string, KeySource> = {};
  const fromCheckout: string[] = [];
  for (const name of names) {
    const found: Array<[KeySource, string | undefined]> = [['env', env[name]], ['repo', repoKeys[name]], ['user', userKeys[name]], ['checkout', checkoutKeys[name]]];
    const hit = found.find(([, v]) => typeof v === 'string' && v.length > 0);
    if (!hit) {
      sources[name] = 'missing';
      continue;
    }
    values[name] = hit[1] as string;
    sources[name] = hit[0];
    if (hit[0] === 'checkout') fromCheckout.push(name);
  }
  for (const r of refusals) process.stderr.write(`stint: ${r}\n`);
  if (fromCheckout.length) {
    process.stderr.write(`stint: read ${fromCheckout.join(', ')} from ${checkoutEnv}; move them to ${userFile} (stint keys set <NAME>), which works in every repository\n`);
  }
  return { values, sources, refusals };
}

/** Puts every loaded key that the environment does not already have into it, and returns where each came from. */
export function applyKeys(repoRoot: string, opts: { checkout?: string } = {}): ReturnType<typeof loadKeys> {
  const loaded = loadKeys(repoRoot, opts);
  for (const [name, value] of Object.entries(loaded.values)) if (!process.env[name]) process.env[name] = value;
  return loaded;
}
