import { createHash } from 'node:crypto';
import type { Handoff } from './schemas/handoff';

/** Keys sorted recursively, no whitespace. The input to every hash Stint writes. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** `sha256:` over the canonical packet without its `hash` field. */
export function hashHandoff(h: Omit<Handoff, 'hash'> & { hash?: string }): string {
  const { hash: _ignored, ...rest } = h;
  return `sha256:${sha256Hex(canonicalJSON(rest))}`;
}
