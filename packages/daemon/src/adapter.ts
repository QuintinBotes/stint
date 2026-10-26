import type { CapabilityLevel, Cost, EndedBy, GateStrength, Handoff, NewEvent, Role, Task, Vendor } from '@stint-dev/core';

export type Availability = { ok: boolean; version?: string; reason?: string };

export type AdapterCapabilities = {
  editsFiles: boolean;
  runsCommands: boolean;
  resumable: boolean;
  structuredOutput: boolean;
  offline: boolean;
};

/** An event an adapter reports; the daemon adds task, run, adapter and vendor before it lands in the log. */
export type AdapterEvent = Omit<NewEvent, 'task' | 'run' | 'adapter' | 'vendor' | 'type'> & { type: string };

export type RunContext = {
  task: Task;
  run: string;
  role: Role;
  worktree: string;
  prompt: string;
  promptPath: string;
  model?: string;
  budget: { tokens: number; steps?: number; maxTurns?: number; timeoutMs?: number };
  env: Record<string, string>;
  signal: AbortSignal;
  emit: (e: AdapterEvent) => Promise<void>;
  transcript: (line: string) => Promise<{ pointer: string; byteLen: number }>;
};

export type RunResult = {
  endedBy: EndedBy;
  cost: Cost;
  sessionId?: string;
  host?: string;
  model?: string;
  transcriptPath?: string;
  lastMessage?: string;
};

export type Enrichment = Partial<Pick<Handoff, 'summary' | 'leftOut' | 'risks' | 'askOfNext'>>;

/** The adapter contract: adapters never touch `.stint/`; the daemon writes everything they report. */
export interface Adapter {
  id: string;
  vendor: Vendor;
  roles: Role[];
  capabilities: AdapterCapabilities;
  available(): Promise<Availability>;
  /** `enforced` only once a gate has actually fired in this daemon's lifetime. */
  gate(): GateStrength;
  run(ctx: RunContext): Promise<RunResult>;
  resume?(ctx: RunContext & { sessionId: string; instruction: string }): Promise<RunResult>;
  enrich?(ctx: { task: Task; run: string; sessionId?: string; worktree: string }): Promise<Enrichment>;
}

/** Adapters Stint knows about; health always lists every one of them, configured or not. */
export const KNOWN_ADAPTERS: Array<{ id: string; vendor: Vendor; roles: Role[]; arrivesIn: string }> = [
  { id: 'muse-code', vendor: 'meta', roles: ['planner', 'implementer', 'reviewer'], arrivesIn: 'R-009' },
  { id: 'claude-code', vendor: 'anthropic', roles: ['implementer', 'reviewer'], arrivesIn: 'R-013' },
  { id: 'openai-compatible', vendor: 'meta', roles: ['planner', 'reviewer'], arrivesIn: 'R-010' },
  { id: 'replay', vendor: 'local', roles: ['planner', 'implementer', 'reviewer'], arrivesIn: 'R-006' },
];

export type AdapterHealth = {
  id: string;
  vendor: Vendor;
  roles: Role[];
  capability: CapabilityLevel;
  gate: GateStrength;
  version?: string;
  reason?: string;
};

export async function adapterHealth(adapters: Adapter[]): Promise<AdapterHealth[]> {
  const out: AdapterHealth[] = [];
  const seen = new Set<string>();
  for (const a of adapters) {
    seen.add(a.id);
    let av: Availability;
    try {
      av = await a.available();
    } catch (err) {
      av = { ok: false, reason: `availability check failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    out.push({
      id: a.id,
      vendor: a.vendor,
      roles: a.roles,
      capability: av.ok ? { level: 'supported' } : { level: 'unsupported', reason: av.reason ?? 'unavailable' },
      gate: a.gate(),
      ...(av.version ? { version: av.version } : {}),
      ...(av.reason ? { reason: av.reason } : {}),
    });
  }
  for (const k of KNOWN_ADAPTERS) {
    if (seen.has(k.id)) continue;
    const reason = `not configured; the adapter arrives in ${k.arrivesIn}`;
    out.push({ id: k.id, vendor: k.vendor, roles: k.roles, capability: { level: 'unsupported', reason }, gate: 'none', reason });
  }
  return out;
}

/** The replay adapter: it never runs a model; the replayer (R-006) emits recorded events through the daemon. */
export const replayAdapter: Adapter = {
  id: 'replay',
  vendor: 'local',
  roles: ['planner', 'implementer', 'reviewer'],
  capabilities: { editsFiles: false, runsCommands: false, resumable: false, structuredOutput: false, offline: true },
  available: async () => ({ ok: true, version: 'stint.recording/1' }),
  gate: () => 'none',
  run: async () => ({ endedBy: 'completed', cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0, estimated: true } }),
};
