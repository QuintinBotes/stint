import type { Config } from '@stint-dev/core';

export type ModelHealth = { host: string; model: string; roles: string[]; ready: boolean; reason: string | null; offline: boolean };

const ROLE_OF: Record<string, string> = { planner: 'plans', reviewer: 'reviews', agent: 'builds', learn: 'learns', summary: 'summarises' };

let cache: { at: number; key: string; value: ModelHealth[] } | null = null;

/**
 * Every model the routes name, whether it can answer now, and what it does: a cloud host is ready when its
 * key is set (no request is made); a local host is asked, briefly, whether it has the model pulled.
 */
export async function modelHealth(config: Config, env: Record<string, string | undefined> = process.env): Promise<ModelHealth[]> {
  const key = JSON.stringify([config.routes, config.hosts]);
  if (cache && cache.key === key && Date.now() - cache.at < 30_000) return cache.value;
  const byEntry = new Map<string, Set<string>>();
  for (const [role, chain] of Object.entries(config.routes)) {
    for (const entry of chain ?? []) byEntry.set(entry, new Set([...(byEntry.get(entry) ?? []), ROLE_OF[role] ?? role]));
  }
  const pulled = new Map<string, Set<string> | null>();
  const out: ModelHealth[] = [];
  for (const [entry, roles] of byEntry) {
    const [host = '', ...rest] = entry.split('/');
    const model = rest.join('/');
    const h = config.hosts[host];
    const base = { host, model, roles: [...roles].sort(), offline: !!h?.offline };
    if (!h) {
      out.push({ ...base, ready: false, reason: `no host ${host} in config` });
      continue;
    }
    if (h.keyEnv && !env[h.keyEnv]) {
      out.push({ ...base, ready: false, reason: `${h.keyEnv} is not set` });
      continue;
    }
    const url = h.baseURL ?? (h.baseURLEnv ? env[h.baseURLEnv] : undefined);
    if (!url) {
      out.push({ ...base, ready: false, reason: `${h.baseURLEnv ?? 'baseURL'} is not set` });
      continue;
    }
    if (!h.keyEnv) {
      if (!pulled.has(host)) {
        const tags = await fetch(new URL('/api/tags', url).toString(), { signal: AbortSignal.timeout(800) })
          .then((r) => (r.ok ? (r.json() as Promise<{ models?: Array<{ name: string }> }>) : null))
          .catch(() => null);
        pulled.set(host, tags ? new Set((tags.models ?? []).map((m) => m.name)) : null);
      }
      const names = pulled.get(host);
      const id = h.models[model] ?? model;
      out.push({ ...base, ready: !!names?.has(id), reason: names ? (names.has(id) ? null : `${id} is not pulled`) : `${host} is not running` });
      continue;
    }
    out.push({ ...base, ready: true, reason: null });
  }
  cache = { at: Date.now(), key, value: out };
  return out;
}
