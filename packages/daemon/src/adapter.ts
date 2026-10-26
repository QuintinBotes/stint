import type { Adapter, AgentDef, Availability, CapabilityLevel, Config, GateStrength, Role, Vendor } from '@stint-dev/core';
import readership from '../../core/src/readership.json';

export type { Adapter, AdapterCapabilities, AdapterEvent, Availability, Enrichment, PermissionOption, PermissionRequest, RunContext, RunResult } from '@stint-dev/core';

/** Adapters Stint knows about; health always lists every one of them, configured or not. */
export const KNOWN_ADAPTERS: Array<{ id: string; vendor: Vendor; roles: Role[]; arrivesIn: string }> = [
  { id: 'muse-code', vendor: 'meta', roles: ['planner', 'implementer', 'reviewer'], arrivesIn: 'R-009' },
  { id: 'stint-agent', vendor: 'meta', roles: ['implementer', 'reviewer'], arrivesIn: 'R-013' },
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
  /** The harness that runs this agent, for configured agents (R-032). */
  harness?: string;
  host?: string | null;
  model?: string | null;
  enabled?: boolean;
  /** Whether the agent's command is on PATH (or the built-in adapter answers). */
  available?: boolean;
  /** The manifest's capability flags, when the agent comes from config (R-032). */
  capabilities?: AgentDef['capabilities'];
  /** Which instruction files the agent reads, each verified or unknown, and against which version. */
  reads?: Record<string, string>;
  verifiedAgainst?: string;
};

const READS = readership as Record<string, { reads: Record<string, string>; verifiedAgainst: string }>;

function manifestCapabilities(def: AgentDef | undefined, adapter?: Adapter): AgentDef['capabilities'] {
  if (def?.capabilities) return def.capabilities;
  if (adapter) {
    return { resume: adapter.capabilities.resumable, schemaOutput: adapter.capabilities.structuredOutput, sandbox: false, costReporting: false };
  }
  if (def) return { resume: !!def.resume, schemaOutput: !!def.events, sandbox: false, costReporting: !!def.events };
  return undefined;
}

export async function adapterHealth(adapters: Adapter[], config?: Pick<Config, 'agents' | 'adapters'>): Promise<AdapterHealth[]> {
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
    const def = config?.agents?.[a.id];
    const model = def?.model ?? (typeof config?.adapters?.[a.id]?.model === 'string' ? (config.adapters[a.id]?.model as string) : null);
    out.push({
      id: a.id,
      vendor: a.vendor,
      roles: a.roles,
      capability: av.ok ? { level: 'supported' } : { level: 'unsupported', reason: av.reason ?? 'unavailable' },
      gate: a.gate(),
      harness: def?.harness ?? (a.id === 'muse-code' || a.id === 'stint-agent' || a.id === 'replay' ? a.id : 'cli'),
      host: def?.host ?? null,
      model,
      enabled: def ? def.enabled : true,
      available: av.ok,
      capabilities: manifestCapabilities(def, a),
      ...(av.version ? { version: av.version } : {}),
      ...(av.reason ? { reason: av.reason } : {}),
      ...(READS[a.id] ? { reads: READS[a.id]?.reads, verifiedAgainst: READS[a.id]?.verifiedAgainst } : {}),
    });
  }
  // Every configured agent is listed, disabled ones as disabled rather than hidden (R-032).
  for (const [id, def] of Object.entries(config?.agents ?? {})) {
    if (seen.has(id)) continue;
    seen.add(id);
    const bin = def.command[0] as string;
    const onPath = !!Bun.which(bin);
    const reason = !def.enabled ? 'disabled in config; set enabled to true to use it' : onPath ? 'enabled but not registered' : `${bin} is not on PATH`;
    out.push({
      id,
      vendor: def.vendor,
      roles: def.roles,
      capability: { level: 'unsupported', reason },
      gate: 'observed',
      harness: def.harness ?? 'cli',
      host: def.host ?? null,
      model: def.model ?? null,
      enabled: def.enabled,
      available: onPath,
      capabilities: manifestCapabilities(def),
      reason,
      ...(onPath ? { version: bin } : {}),
    });
  }
  for (const k of KNOWN_ADAPTERS) {
    if (seen.has(k.id)) continue;
    const reason = `not configured; the adapter arrives in ${k.arrivesIn}`;
    out.push({ id: k.id, vendor: k.vendor, roles: k.roles, capability: { level: 'unsupported', reason }, gate: 'none', reason, harness: k.id, host: null, model: null, available: false });
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
