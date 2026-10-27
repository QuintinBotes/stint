import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigSchema, type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { STINT_CHECKOUT, userKeyFile } from '@stint-dev/core/node';
import { adapterHealth, defaultAdapters, sandboxAvailable } from '@stint-dev/daemon';
import { defineCommand } from 'citty';
import { keyReport } from './keys';
import { repoRoot } from './repo';
import { hostBaseURL, isLocalHost } from './up';

export type Check = { id: string; status: 'ok' | 'warn' | 'fail'; reason: string; fix?: string };

const MIN_BUN = '1.3.14';
const MIN_GIT = '2.40';
// a key whose absence stops the hosted planner and the Stint agent; the rest are fallbacks or opt-in agents
const CORE_KEYS = new Set(['META_API_KEY']);

function atLeast(have: string, need: string): boolean {
  const a = have.split('.').map(Number);
  const b = need.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

const git = (root: string, args: string[]) => {
  const r = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' });
  return { ok: r.exitCode === 0, out: r.stdout.toString().trim() };
};

function readConfig(root: string): Config {
  try {
    const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(join(root, '.stint', 'config.json'), 'utf8')));
    return parsed.success ? parsed.data : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 2000): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

type HealthAdapter = { id: string; enabled?: boolean; available?: boolean; capability: { level: string; reason?: string } };

/** Every check, in the order a person fixes them. Nothing here calls a hosted model or prints a key's value. */
export async function doctorChecks(root: string): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  add(atLeast(Bun.version, MIN_BUN)
    ? { id: 'bun', status: 'ok', reason: `Bun ${Bun.version}` }
    : { id: 'bun', status: 'fail', reason: `Bun ${Bun.version} is older than ${MIN_BUN}`, fix: 'bun upgrade' });
  const gitVersion = /(\d+\.\d+(\.\d+)?)/.exec(Bun.spawnSync(['git', '--version'], { stdout: 'pipe' }).stdout.toString())?.[1] ?? '0';
  add(atLeast(gitVersion, MIN_GIT)
    ? { id: 'git', status: 'ok', reason: `git ${gitVersion}` }
    : { id: 'git', status: 'fail', reason: `git ${gitVersion} is older than ${MIN_GIT}`, fix: 'brew install git' });

  const onPath = Bun.which('stint', { PATH: process.env.PATH ?? '' });
  if (!onPath) add({ id: 'stint.path', status: 'warn', reason: 'stint is not on PATH', fix: `bash ${join(STINT_CHECKOUT, 'scripts', 'install-cli.sh')}` });
  else {
    let shim = '';
    try {
      shim = readFileSync(onPath, 'utf8');
    } catch {
      // a binary, not a shim
    }
    add(shim.includes(STINT_CHECKOUT)
      ? { id: 'stint.path', status: 'ok', reason: `${onPath} runs this checkout` }
      : { id: 'stint.path', status: 'warn', reason: `${onPath} runs another copy of Stint`, fix: `bash ${join(STINT_CHECKOUT, 'scripts', 'install-cli.sh')}` });
  }

  // the daemon this repository's `stint up` wrote down, if it still answers
  let health: { adapters?: HealthAdapter[] } | null = null;
  const info = join(root, '.stint', 'cache', 'daemon.json');
  if (existsSync(info)) {
    try {
      const { port, token } = JSON.parse(readFileSync(info, 'utf8')) as { port: number; token: string };
      const url = `http://127.0.0.1:${port}`;
      health = (await getJson(`${url}/api/health`, { Authorization: `Bearer ${token}` })) as typeof health;
      if (health) add({ id: 'daemon', status: 'ok', reason: `running at ${url}` });
    } catch {
      // unreadable: treated as not running
    }
  }
  if (!health) add({ id: 'daemon', status: 'fail', reason: 'not running for this repository', fix: 'stint up' });

  const isRepo = git(root, ['rev-parse', '--is-inside-work-tree']).ok;
  add(isRepo ? { id: 'repo.git', status: 'ok', reason: root } : { id: 'repo.git', status: 'fail', reason: `${root} is not a git repository`, fix: 'git init' });
  if (isRepo) {
    const hasCommits = git(root, ['rev-parse', '--verify', 'HEAD']).ok;
    add(hasCommits ? { id: 'repo.commits', status: 'ok', reason: 'has commits' } : { id: 'repo.commits', status: 'fail', reason: 'no commits yet; worktrees need one', fix: 'git commit --allow-empty -m "Start"' });
    const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']).out.split('\n').filter(Boolean).map((l) => l.slice(3));
    add(dirty.length === 0
      ? { id: 'repo.clean', status: 'ok', reason: 'no uncommitted changes to tracked files' }
      : { id: 'repo.clean', status: 'fail', reason: `uncommitted changes: ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? `, and ${dirty.length - 5} more` : ''}`, fix: 'git stash' });
    const env = join(root, '.env');
    if (existsSync(env)) {
      const tracked = git(root, ['ls-files', '--error-unmatch', '.env']).ok;
      const ignored = !tracked && git(root, ['check-ignore', '-q', '.env']).ok;
      add(ignored
        ? { id: 'repo.env', status: 'ok', reason: '.env is ignored by git' }
        : { id: 'repo.env', status: 'fail', reason: `.env is ${tracked ? 'tracked by' : 'not ignored by'} git, so Stint will not read it`, fix: tracked ? 'git rm --cached .env && echo .env >> .gitignore' : 'echo .env >> .gitignore' });
    } else add({ id: 'repo.env', status: 'ok', reason: 'no .env in this repository' });
  }
  add(existsSync(join(root, '.stint', 'config.json'))
    ? { id: 'repo.init', status: 'ok', reason: '.stint/ is initialised' }
    : { id: 'repo.init', status: 'fail', reason: '.stint/ is not initialised', fix: 'stint init' });

  const { sources } = keyReport(root);
  for (const [name, source] of Object.entries(sources)) {
    if (source !== 'missing') add({ id: `key.${name}`, status: source === 'checkout' ? 'warn' : 'ok', reason: `from ${source === 'user' ? userKeyFile() : source}`, ...(source === 'checkout' ? { fix: `stint keys set ${name}` } : {}) });
    else if (CORE_KEYS.has(name)) add({ id: `key.${name}`, status: 'warn', reason: 'not set; hosted planning and the Stint agent need it', fix: `stint keys set ${name}` });
  }
  const userFile = userKeyFile();
  if (existsSync(userFile) && statSync(userFile).mode & 0o077) add({ id: 'keys.file', status: 'warn', reason: `${userFile} can be read by others`, fix: `chmod 600 ${userFile}` });

  const config = readConfig(root);
  const served = (health as { adapters?: HealthAdapter[] } | null)?.adapters;
  const agents: HealthAdapter[] = served ?? (await adapterHealth(defaultAdapters(config), config));
  for (const a of agents.filter((x) => x.enabled !== false && x.id !== 'replay')) {
    add(a.capability.level === 'supported'
      ? { id: `agent.${a.id}`, status: 'ok', reason: 'available' }
      : { id: `agent.${a.id}`, status: 'warn', reason: a.capability.reason ?? a.capability.level });
  }

  const reviewerLocal = (config.routes.reviewer ?? []).map((e) => [e.slice(0, e.indexOf('/')), e.slice(e.indexOf('/') + 1)] as const).find(([h]) => {
    const host = config.hosts[h];
    return host && isLocalHost(host, process.env);
  });
  const ollama = config.hosts.ollama;
  const base = ollama ? hostBaseURL(ollama, process.env) : null;
  if (!base) add({ id: 'ollama', status: 'warn', reason: 'no Ollama host configured; the offline review needs one' });
  else {
    const origin = new URL(base).origin;
    const tags = (await getJson(`${origin}/api/tags`, {}, 1500)) as { models?: Array<{ name: string }> } | null;
    if (!tags) add({ id: 'ollama', status: 'warn', reason: `Ollama is not reachable at ${origin}; the offline review needs it`, fix: 'ollama serve' });
    else if (reviewerLocal && reviewerLocal[0] === 'ollama') {
      const model = ollama?.models[reviewerLocal[1]] ?? reviewerLocal[1];
      const pulled = (tags.models ?? []).some((m) => m.name === model);
      add(pulled ? { id: 'ollama', status: 'ok', reason: `${model} is pulled` } : { id: 'ollama', status: 'warn', reason: `the reviewer model ${model} is not pulled`, fix: `ollama pull ${model}` });
    } else add({ id: 'ollama', status: 'ok', reason: `reachable at ${origin}` });
  }

  const kind = config.sandbox?.kind ?? 'none';
  if (kind === 'none') add({ id: 'sandbox', status: 'ok', reason: 'off: agents run in their worktree without a sandbox' });
  else {
    const av = await sandboxAvailable(kind);
    add(av.ok ? { id: 'sandbox', status: 'ok', reason: `${kind} is available` } : { id: 'sandbox', status: 'fail', reason: av.reason ?? `${kind} is not available`, fix: kind === 'docker' ? 'open -a Docker' : 'set sandbox.kind to none in .stint/config.json' });
  }
  return checks;
}

export const doctor = defineCommand({
  meta: { name: 'doctor', description: 'Check this machine and repository for Stint, one line per check with the fix' },
  args: {
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    json: { type: 'boolean', description: 'Machine-readable output' },
  },
  async run({ args }) {
    const checks = await doctorChecks(repoRoot(args.repo));
    const ok = !checks.some((c) => c.status === 'fail');
    if (args.json) process.stdout.write(`${JSON.stringify({ checks, ok })}\n`);
    else {
      for (const c of checks) process.stdout.write(`${c.status.padEnd(4)}  ${c.id.padEnd(22)} ${c.reason}${c.fix ? `\n      fix: ${c.fix}` : ''}\n`);
      process.stdout.write(ok ? '\nNothing fails.\n' : '\nFix the failing lines above, then run stint doctor again.\n');
    }
    process.exit(ok ? 0 : 1);
  },
});
