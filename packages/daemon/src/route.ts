import { HostError, StructuredOutputError, type Host } from '@stint-dev/adapter-openai-compatible';
import type { Cost } from '@stint-dev/core';

export type RouteEvent = { type: string; payload: Record<string, unknown> };
export type RouteEmit = (event: RouteEvent) => void | Promise<void>;

export type ChainAttempt = { host: string; model: string; reason: string; detail?: string };

export class ChainExhaustedError extends Error {
  readonly attempts: ChainAttempt[];
  readonly role: string;

  constructor(role: string, attempts: ChainAttempt[]) {
    super(
      `chain for role ${role} is exhausted: ${attempts.map((a) => `${a.host}/${a.model} (${a.reason})`).join(', ') || 'no entries'}`,
    );
    this.name = 'ChainExhaustedError';
    this.role = role;
    this.attempts = attempts;
  }
}

export type ChainCallContext = {
  host: Host;
  hostId: string;
  model: string;
  role: string;
  timeoutMs: number;
  emit: RouteEmit;
  onRetry: (info: { host: string; model?: string; errors: string }) => Promise<void>;
};

export type ChainCall<T> = (host: Host, model: string, ctx: ChainCallContext) => Promise<unknown>;

export type WalkChainResult<T> = { value: T; host: string; model: string; cost: Cost; retries: number };

export type HostsById = Record<string, Host> | Map<string, Host> | Host[];

const ROLE_TIMEOUTS: Record<string, number> = { planner: 60_000, reviewer: 120_000 };
const ZERO_COST: Cost = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null };

function hostById(hosts: HostsById, id: string): Host | undefined {
  if (hosts instanceof Map) return hosts.get(id);
  if (Array.isArray(hosts)) return hosts.find((host) => host.id === id);
  return hosts[id];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function errorReason(error: unknown): { reason: string; retryable: boolean; detail?: string } {
  if (error instanceof StructuredOutputError) return { reason: 'invalid_output', retryable: true, detail: error.errors };
  if (error instanceof HostError) return { reason: error.reason, retryable: true, detail: error.message };
  if (isRecord(error) && (error.name === 'StructuredOutputError' || typeof error.errors === 'string')) {
    return { reason: 'invalid_output', retryable: true, detail: String(error.errors ?? '') };
  }
  if (isRecord(error) && error.name === 'HostError' && typeof error.reason === 'string') {
    return { reason: error.reason, retryable: true, detail: error instanceof Error ? error.message : undefined };
  }
  return { reason: 'error', retryable: false };
}

function availabilityReason(reason: string | undefined): string {
  if (!reason) return 'unavailable';
  if (/not set/.test(reason)) return 'no_key';
  return reason;
}

function splitEntry(entry: string): { hostId: string; model: string } {
  const slash = entry.indexOf('/');
  if (slash < 0) return { hostId: entry, model: '' };
  return { hostId: entry.slice(0, slash), model: entry.slice(slash + 1) };
}

function unwrap<T>(result: unknown, hostId: string, model: string): WalkChainResult<T> {
  if (isRecord(result) && 'value' in result) {
    const cost = isRecord(result.cost) ? (result.cost as unknown as Cost) : ZERO_COST;
    return {
      value: result.value as T,
      host: typeof result.host === 'string' ? result.host : hostId,
      model: typeof result.model === 'string' ? result.model : model,
      cost,
      retries: typeof result.retries === 'number' ? result.retries : 0,
    };
  }
  const cost = isRecord(result) && isRecord(result.cost) ? (result.cost as unknown as Cost) : ZERO_COST;
  return { value: result as T, host: hostId, model, cost, retries: 0 };
}

/**
 * Walk a host/model chain in order. An unavailable host is skipped, a HostError or a
 * StructuredOutputError moves to the next entry, and every move emits provider.fallback.
 * The call may return a complete() result or a bare Plan or Review.
 */
export async function walkChain<T>(args: {
  role: string;
  chain: string[];
  hosts: HostsById;
  call: ChainCall<T>;
  emit?: RouteEmit;
  timeoutMs?: number;
}): Promise<WalkChainResult<T>> {
  const emit: RouteEmit = args.emit ?? (() => undefined);
  const timeoutMs = args.timeoutMs ?? ROLE_TIMEOUTS[args.role] ?? 60_000;
  const attempts: ChainAttempt[] = [];
  const entries = args.chain.map(splitEntry);

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] as (typeof entries)[number];
    const next = entries[index + 1];
    const moveOn = async (attempt: ChainAttempt) => {
      attempts.push(attempt);
      if (next) {
        await emit({
          type: 'provider.fallback',
          payload: { role: args.role, from: entry.hostId, to: next.hostId, reason: attempt.reason },
        });
      }
    };

    const host = hostById(args.hosts, entry.hostId);
    if (!host) {
      await moveOn({ host: entry.hostId, model: entry.model, reason: 'unknown_host' });
      continue;
    }

    let availability: { ok: boolean; reason?: string };
    try {
      availability = await host.available();
    } catch (error) {
      availability = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (!availability.ok) {
      await moveOn({
        host: entry.hostId,
        model: entry.model,
        reason: availabilityReason(availability.reason),
        detail: availability.reason,
      });
      continue;
    }

    let retryNotes = 0;
    const noteRetry = async (info: { errors: string }) => {
      retryNotes++;
      await emit({ type: 'provider.retry', payload: { role: args.role, host: entry.hostId, errors: info.errors } });
    };
    const ctx: ChainCallContext = {
      host,
      hostId: entry.hostId,
      model: entry.model,
      role: args.role,
      timeoutMs,
      emit: async (event) => {
        if (event.type === 'provider.retry') {
          retryNotes++;
          await emit({ type: event.type, payload: { role: args.role, ...event.payload, host: entry.hostId } });
          return;
        }
        await emit(event);
      },
      onRetry: noteRetry,
    };

    try {
      const raw = await args.call(host, entry.model, ctx);
      const result = unwrap<T>(raw, entry.hostId, entry.model);
      if (result.retries > 0 && retryNotes === 0) {
        const errors = isRecord(raw) && typeof raw.retryErrors === 'string' ? raw.retryErrors : 'validation failed';
        await noteRetry({ errors });
      }
      return result;
    } catch (error) {
      const { reason, retryable, detail } = errorReason(error);
      if (!retryable) throw error;
      await moveOn({ host: entry.hostId, model: entry.model, reason, detail });
    }
  }

  throw new ChainExhaustedError(args.role, attempts);
}
