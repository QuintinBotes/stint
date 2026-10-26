export type PreflightDeps = {
  env?: Record<string, string | undefined>;
  allowOnline?: boolean;
  checkOllama?: () => Promise<boolean>;
  checkMuse?: () => boolean | Promise<boolean>;
};

export type PreflightResult = { ok: boolean; needs: string[]; missing: string[] };

export const GLIMMER_MODEL = 'muse-glimmer:30b-mlx';

/** Ollama on localhost with the review model pulled. A refused connection is a fast no. */
export async function defaultCheckOllama(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    return (body.models ?? []).some((m) => m.name === GLIMMER_MODEL || m.model === GLIMMER_MODEL);
  } catch {
    return false;
  }
}

export function defaultCheckMuse(): boolean {
  return Bun.which('muse') !== null;
}

/**
 * What a live run needs, checked before anything starts. The order is the refusal order:
 * the first missing entry is the one named. With --allow-online the review falls back to the
 * hosted chain, so Ollama is not required.
 */
export async function checkPreflight(deps: PreflightDeps = {}): Promise<PreflightResult> {
  const env = deps.env ?? process.env;
  const needs = ['META_API_KEY', ...(deps.allowOnline ? [] : [`Ollama running with ${GLIMMER_MODEL} pulled`]), 'muse on the PATH'];
  const missing: string[] = [];
  if (!env.META_API_KEY) missing.push('META_API_KEY');
  if (!deps.allowOnline && !(await (deps.checkOllama ?? defaultCheckOllama)())) missing.push(`Ollama running with ${GLIMMER_MODEL} pulled`);
  if (!(await (deps.checkMuse ?? defaultCheckMuse)())) missing.push('muse on the PATH');
  return { ok: missing.length === 0, needs, missing };
}

/** Throws naming the first missing need; the CLI turns that into a refusal to start. */
export async function assertPreflight(deps: PreflightDeps = {}): Promise<PreflightResult> {
  const r = await checkPreflight(deps);
  if (!r.ok) throw new Error(`stint demo --live needs ${r.needs.join(', ')}. Missing: ${r.missing[0]}.`);
  return r;
}
