// The adapter contract. Adapters never touch .stint/; the daemon writes everything they report.
import type { CapabilityLevel, GateStrength } from './schemas/capability';
import type { NewEvent } from './schemas/event';
import type { Cost, EndedBy, Handoff, Role, Vendor } from './schemas/handoff';
import type { Task } from './schemas/task';

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

/** One choice an agent offers when it asks permission (R-033). */
export type PermissionOption = { optionId: string; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string };

/** A permission question from an agent, answered by a person through the daemon (R-033). */
export type PermissionRequest = { requestId: string; tool: string; title: string; options: PermissionOption[] };

export type RunContext = {
  /** Called with the agent's process id once it is spawned, so a stop can kill its process group. */
  onSpawn?: (pid: number) => void;
  task: Task;
  run: string;
  role: Role;
  worktree: string;
  prompt: string;
  promptPath: string;
  /** Skills mounted for this run, already listed in the prompt; an adapter may also name them in its own system prompt. */
  skills?: Array<{ name: string; description: string }>;
  model?: string;
  budget: { tokens: number; steps?: number; maxTurns?: number; timeoutMs?: number };
  env: Record<string, string>;
  /** Wraps a command line in the run's sandbox (R-040); adapters apply it to every process they start. */
  wrap?: (argv: string[]) => string[];
  signal: AbortSignal;
  /** Asks a person to allow or reject one agent action; resolves with the chosen option or 'cancelled' (R-033). */
  askPermission?: (req: PermissionRequest) => Promise<{ optionId: string } | 'cancelled'>;
  emit: (e: AdapterEvent) => Promise<void>;
  transcript: (line: string) => Promise<{ pointer: string; byteLen: number }>;
};

export type RunResult = {
  endedBy: EndedBy;
  /** The last tool call that never got a result: the in-flight step when the run was killed. */
  inFlight?: string | null;
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
  /** Credential variables the agent needs; every other key stays in the daemon (R-040). */
  needsEnv?: string[];
  resume?(ctx: RunContext & { sessionId: string; instruction: string }): Promise<RunResult>;
  enrich?(ctx: { task: Task; run: string; sessionId?: string; worktree: string; model?: string }): Promise<Enrichment>;
}
