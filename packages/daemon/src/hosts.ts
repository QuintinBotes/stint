import type { Config, HostConfig } from '@stint-dev/core';

/** `latencyMs` is measured only for a local host, which is asked; a cloud host is never called by health, so it is null. */
export type ModelHealth = { host: string; model: string; roles: string[]; ready: boolean; reason: string | null; offline: boolean; structuredOutput: HostConfig['structuredOutput'] | null; latencyMs: number | null };
export type ChainEntry = { entry: string; ready: boolean; reason: string | null };

const ROLE_OF: Record<string, string> = { planner: 'plans', reviewer: 'reviews', agent: 'builds', learn: 'learns', summary: 'summarises', quiz: 'checks packets', recall: 'checks packets' };

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
  const pulled = new Map<string, { names: Set<string> | null; ms: number }>();
  const out: ModelHealth[] = [];
  for (const [entry, roles] of byEntry) {
    const [host = '', ...rest] = entry.split('/');
    const model = rest.join('/');
    const h = config.hosts[host];
    const base = { host, model, roles: [...roles].sort(), offline: !!h?.offline, structuredOutput: h?.structuredOutput ?? null, latencyMs: null };
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
        const t0 = performance.now();
        const tags = await fetch(new URL('/api/tags', url).toString(), { signal: AbortSignal.timeout(800) })
          .then((r) => (r.ok ? (r.json() as Promise<{ models?: Array<{ name: string }> }>) : null))
          .catch(() => null);
        pulled.set(host, { names: tags ? new Set((tags.models ?? []).map((m) => m.name)) : null, ms: Math.round(performance.now() - t0) });
      }
      const { names, ms } = pulled.get(host) as { names: Set<string> | null; ms: number };
      const id = h.models[model] ?? model;
      out.push({ ...base, latencyMs: names ? ms : null, ready: !!names?.has(id), reason: names ? (names.has(id) ? null : `${id} is not pulled`) : `${host} is not running` });
      continue;
    }
    out.push({ ...base, ready: true, reason: null });
  }
  cache = { at: Date.now(), key, value: out };
  return out;
}

/** Each role's chain in the order it is walked, with whether each entry can answer now (R-010). */
export function chainHealth(config: Config, models: ModelHealth[]): Record<string, ChainEntry[]> {
  const byEntry = new Map(models.map((m) => [`${m.host}/${m.model}`, m]));
  return Object.fromEntries(
    Object.entries(config.routes).map(([role, chain]) => [
      role,
      (chain ?? []).map((entry) => {
        const m = byEntry.get(entry);
        return m ? { entry, ready: m.ready, reason: m.reason } : { entry, ready: false, reason: 'not checked' };
      }),
    ]),
  );
}

export type LocalModel = { host: string; model: string; parameters: string | null };

let localCache: { at: number; key: string; value: LocalModel[] } | null = null;

/**
 * Chat models pulled on a keyless local host that no route names: what a person can run without a key, with
 * `stint hand <task> stint-agent --model <host>/<model>`. Embedding models (BERT family) cannot take a run.
 */
export async function localModels(config: Config, env: Record<string, string | undefined> = process.env): Promise<LocalModel[]> {
  const key = JSON.stringify([config.routes, config.hosts]);
  if (localCache && localCache.key === key && Date.now() - localCache.at < 30_000) return localCache.value;
  const routed = new Set(Object.values(config.routes).flatMap((chain) => chain ?? []));
  const out: LocalModel[] = [];
  for (const [host, h] of Object.entries(config.hosts)) {
    const url = h.baseURL ?? (h.baseURLEnv ? env[h.baseURLEnv] : undefined);
    if (h.keyEnv || !url) continue;
    const tags = await fetch(new URL('/api/tags', url).toString(), { signal: AbortSignal.timeout(800) })
      .then((r) => (r.ok ? (r.json() as Promise<{ models?: Array<{ name: string; details?: { family?: string; families?: string[] | null; parameter_size?: string } }> }>) : null))
      .catch(() => null);
    // LM Studio and llama.cpp have no /api/tags; they list models the OpenAI way, without a family to go by
    const listed = tags
      ? (tags.models ?? [])
      : ((await fetch(`${url.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(800) })
          .then((r) => (r.ok ? (r.json() as Promise<{ data?: Array<{ id: string }> }>) : null))
          .catch(() => null))?.data ?? []).filter((m) => !/embed|bge-|\be5-|minilm/i.test(m.id)).map((m) => ({ name: m.id, details: undefined }));
    for (const m of listed) {
      const families = [m.details?.family ?? '', ...(m.details?.families ?? [])];
      if (families.some((f) => /bert/i.test(f))) continue;
      const short = Object.entries(h.models).find(([, id]) => id === m.name)?.[0] ?? m.name;
      if (routed.has(`${host}/${short}`) || routed.has(`${host}/${m.name}`)) continue;
      out.push({ host, model: m.name, parameters: m.details?.parameter_size || null });
    }
  }
  localCache = { at: Date.now(), key, value: out };
  return out;
}
