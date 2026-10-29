import { join } from 'node:path';
import { ConfigSchema, DEFAULT_CONFIG, type Config, type HostConfig } from '@stint-dev/core';
import { defineCommand } from 'citty';
import { startDaemon } from '@stint-dev/daemon';
import { keyReport } from './keys';
import { repoRoot } from './repo';

export type UpReport = {
  /** The line that says a local reviewer model is warming, or null when the reviewer chain has no local entry. */
  warming: string | null;
  /** Settles when the background warm request settles; `stint up` never waits for it. */
  warmDone: Promise<void>;
  /** One line per hosted key: present and accepted, missing, or not checked, said plainly. */
  keyLines: string[];
};

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export function hostBaseURL(host: HostConfig, env: Record<string, string | undefined>): string | null {
  if (host.baseURL) return host.baseURL.replace(/\/+$/, '');
  if (host.baseURLEnv && env[host.baseURLEnv]) return (env[host.baseURLEnv] as string).replace(/\/+$/, '');
  return null;
}

export function isLocalHost(host: HostConfig, env: Record<string, string | undefined>): boolean {
  if (host.offline) return true;
  if (host.keyEnv) return false;
  const url = hostBaseURL(host, env);
  if (!url) return false;
  try {
    const name = new URL(url).hostname;
    return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name === '[::1]';
  } catch {
    return false;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/v1$/, '');
  }
}

/** One short request that loads the model and keeps it for 30 minutes; failures are silent here and loud at review time. */
async function warm(url: string, model: string, fetchFn: FetchFn): Promise<void> {
  try {
    await fetchFn(`${originOf(url)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with OK.' }], stream: false, keep_alive: '30m', options: { num_predict: 1 } }),
    });
  } catch {
    // the reviewer chain reports an unreachable host when a review is asked for
  }
}

async function keyLine(id: string, host: HostConfig, env: Record<string, string | undefined>, fetchFn: FetchFn): Promise<string> {
  const keyEnv = host.keyEnv as string;
  const key = env[keyEnv];
  if (!key) return `${id}: ${keyEnv} not set`;
  const url = hostBaseURL(host, env);
  if (!url) return `${id}: ${host.baseURLEnv ?? 'base URL'} not set, so ${keyEnv} was NOT checked`;
  try {
    const res = await fetchFn(`${url}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
    return res.ok ? `${id}: ${keyEnv} ok` : `${id}: ${keyEnv} was NOT accepted (HTTP ${res.status})`;
  } catch (err) {
    return `${id}: ${keyEnv} could NOT be checked (${err instanceof Error ? err.message : String(err)})`;
  }
}

/**
 * What `stint up` reports beside the daemon URL (R-054): the reviewer's first local model
 * warming in the background, and each hosted key checked against its host's model list.
 * Only `stint up` calls this, so opening a board never loads a model (ADR-0007).
 */
export async function upReport(config: Config, env: Record<string, string | undefined> = process.env, fetchFn: FetchFn = fetch as FetchFn): Promise<UpReport> {
  let warming: string | null = null;
  let warmDone: Promise<void> = Promise.resolve();
  for (const entry of config.routes.reviewer ?? []) {
    const slash = entry.indexOf('/');
    const hostId = slash < 0 ? entry : entry.slice(0, slash);
    const short = slash < 0 ? '' : entry.slice(slash + 1);
    const host = config.hosts[hostId];
    if (!host || !isLocalHost(host, env)) continue;
    const url = hostBaseURL(host, env);
    if (!url) continue;
    const model = host.models[short] ?? short;
    warming = `Warming ${hostId}/${short} in the background; startup does not wait for it.`;
    warmDone = warm(url, model, fetchFn);
    break;
  }
  const keyLines = await Promise.all(
    Object.entries(config.hosts)
      .filter(([, host]) => host.keyEnv && !isLocalHost(host, env))
      .map(([id, host]) => keyLine(id, host, env, fetchFn)),
  );
  return { warming, warmDone, keyLines };
}

async function readConfig(root: string): Promise<Config> {
  try {
    const parsed = ConfigSchema.safeParse(JSON.parse(await Bun.file(join(root, '.stint', 'config.json')).text()));
    return parsed.success ? parsed.data : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export const up = defineCommand({
  meta: { name: 'up', description: 'Start the daemon on 127.0.0.1 for this repository' },
  args: {
    port: { type: 'string', description: 'Port (0 picks a free one)', default: '0' },
    open: { type: 'boolean', description: 'Copy the URL to the clipboard' },
    check: { type: 'boolean', description: 'Start, print health, stop' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    json: { type: 'boolean', description: 'Machine-readable output' },
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    // where each key came from, by name and source only; the daemon reads the values from the environment
    const keys = keyReport(root);
    for (const [name, value] of Object.entries(keys.values)) if (!process.env[name]) process.env[name] = value;
    const d = await startDaemon({ root, port: Number(args.port) || 0, quiet: Boolean(args.check), handleSignals: !args.check, digest: !args.check, autoReview: !args.check });
    const report = await upReport(await readConfig(root));
    const reportLines = () => {
      if (report.warming) process.stdout.write(`${report.warming}\n`);
      for (const line of report.keyLines) process.stdout.write(`  ${line}\n`);
    };
    if (args.check) {
      const health = (await (await fetch(`${d.url}/api/health`)).json()) as { ok: boolean; adapters: Array<{ id: string; capability: { level: string; reason?: string } }> };
      await d.stop();
      if (args.json) {
        process.stdout.write(`${JSON.stringify({ ...health, keys: keys.sources })}\n`);
      } else {
        process.stdout.write(`daemon ok at ${d.url} (stopped after the check)\n`);
        for (const a of health.adapters) {
          const state = a.capability.level === 'supported' ? 'available' : `unavailable: ${a.capability.reason ?? a.capability.level}`;
          process.stdout.write(`  ${a.id.padEnd(18)} ${state}\n`);
        }
        reportLines();
        const set = Object.entries(keys.sources).filter(([, src]) => src !== 'missing');
        process.stdout.write(`  keys: ${set.length ? set.map(([n, src]) => `${n} (${src})`).join(', ') : 'none set; run stint keys set META_API_KEY'}\n`);
      }
      process.exit(health.ok ? 0 : 1);
    }
    process.stdout.write(`Stint is running at ${d.url}\n`);
    reportLines();
    if (args.open) {
      const copy = process.platform === 'darwin' ? ['pbcopy'] : Bun.which('xclip') ? ['xclip', '-selection', 'clipboard'] : null;
      if (copy) {
        const p = Bun.spawn(copy, { stdin: 'pipe' });
        p.stdin.write(d.url);
        p.stdin.end();
        await p.exited;
        process.stdout.write('The URL is on the clipboard.\n');
      }
    }
  },
});
