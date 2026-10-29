import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from '../canonical';
import { writeJsonAtomic } from '../store/files';
import type { Workspace } from '../store/workspace';

/**
 * Embedding similarity for the graph (R-052): used only when `routes.embed` names a host and model.
 * Vectors are cached in .stint/cache/embeddings.json by the hash of the embedded text, so a text is
 * sent to the host once. Any failure is said out loud on stderr and the caller falls back to the
 * shared-files-and-themes score; similarity never silently pretends to be derived.
 */

/** Cosine at or above this makes two tasks similar when embeddings answer. */
export const EMBED_SIMILARITY_THRESHOLD = 0.5;

type EmbedCache = { model: string; vectors: Record<string, number[]> };

const warn = (message: string) => process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', message })}\n`);

export function embeddingsCachePath(ws: Workspace): string {
  return join(ws.cacheDir, 'embeddings.json');
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += (a[i] as number) * (b[i] as number);
    na += (a[i] as number) ** 2;
    nb += (b[i] as number) ** 2;
  }
  if (n === 0 || na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function originOf(base: string): string {
  try {
    return new URL(base).origin;
  } catch {
    return base.replace(/\/v1\/?$/, '');
  }
}

const isVector = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * One vector per text, in order, or null when no embedding model is configured or the host cannot
 * answer. An OpenAI-compatible host is asked at `<base>/embeddings`; the `ollama` host at
 * `<origin>/api/embed`, which is where Ollama serves embeddings.
 */
export async function embedTexts(ws: Workspace, texts: string[]): Promise<number[][] | null> {
  const entry = ws.config.routes.embed?.[0];
  if (!entry || texts.length === 0) return null;
  const hostId = entry.split('/')[0] as string;
  const modelShort = entry.split('/').slice(1).join('/');
  const host = ws.config.hosts[hostId];
  if (!host) {
    warn(`embeddings were NOT used: routes.embed names host "${hostId}", which is not in hosts`);
    return null;
  }
  const base = (host.baseURL ?? (host.baseURLEnv ? process.env[host.baseURLEnv] : undefined))?.replace(/\/+$/, '');
  if (!base) {
    warn(`embeddings were NOT used: host "${hostId}" has no base URL`);
    return null;
  }
  const model = host.models[modelShort] ?? modelShort;

  let cache: EmbedCache = { model, vectors: {} };
  try {
    const stored = JSON.parse(await readFile(embeddingsCachePath(ws), 'utf8')) as EmbedCache;
    if (stored.model === model && stored.vectors && typeof stored.vectors === 'object') cache = stored;
  } catch {
    // no cache yet; every text is fetched below
  }

  const hashes = texts.map((t) => sha256Hex(t));
  const missing = texts.filter((_, i) => !isVector(cache.vectors[hashes[i] as string]));
  if (missing.length > 0) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const key = host.keyEnv ? process.env[host.keyEnv] : undefined;
      if (key) headers.Authorization = `Bearer ${key}`;
      const url = hostId === 'ollama' ? `${originOf(base)}/api/embed` : `${base}/embeddings`;
      const ask = () => fetch(url, { method: 'POST', headers, body: JSON.stringify({ model, input: missing }), signal: AbortSignal.timeout(10_000) });
      // one retry when the connection itself drops (a pooled socket the host had closed); an HTTP error is an answer, not retried
      const res = await ask().catch((err: unknown) => (err instanceof Error && /ECONNRESET|socket connection was closed/i.test(err.message) ? ask() : Promise.reject(err)));
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      const body = (await res.json()) as { embeddings?: unknown; data?: Array<{ embedding?: unknown; index?: number }> };
      const fetched: unknown[] = Array.isArray(body.embeddings)
        ? body.embeddings
        : [...(body.data ?? [])].sort((x, y) => (x.index ?? 0) - (y.index ?? 0)).map((d) => d.embedding);
      if (fetched.length !== missing.length || !fetched.every(isVector)) throw new Error(`${url} returned ${fetched.length} usable vectors for ${missing.length} texts`);
      for (const [i, text] of missing.entries()) cache.vectors[sha256Hex(text)] = fetched[i] as number[];
      await mkdir(ws.cacheDir, { recursive: true });
      await writeJsonAtomic(embeddingsCachePath(ws), cache);
    } catch (err) {
      warn(`embeddings were NOT used: ${err instanceof Error ? err.message : String(err)}; similarity falls back to shared files and themes`);
      return null;
    }
  }
  const out = hashes.map((h) => cache.vectors[h]);
  return out.every(isVector) ? (out as number[][]) : null;
}
