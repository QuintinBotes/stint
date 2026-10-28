// Typed client for the daemon. The daemon is the only writer of .stint/; the UI only reads and asks.
import { type Cost, EVENT_TYPES, type Handoff, type Plan, type Review, type StintEvent, type Task } from '@stint-dev/core';

export type CapabilityLevel = { level: 'supported' | 'partial' | 'unsupported' | 'unknown'; reason?: string; note?: string };
export type AdapterHealth = {
  id: string;
  vendor: string;
  roles: string[];
  capability: CapabilityLevel;
  gate: 'enforced' | 'observed' | 'none';
  version?: string;
  reason?: string;
  harness?: string;
  host?: string | null;
  model?: string | null;
  enabled?: boolean;
  available?: boolean;
  capabilities?: { resume?: boolean; schemaOutput?: boolean; sandbox?: boolean; costReporting?: boolean };
};
export type Health = {
  ok: boolean;
  version: string;
  mode: 'live' | 'replay';
  startedAt: string;
  repo?: string;
  adapters: AdapterHealth[];
  replay?: { title: string; recordedAt: string; live: boolean };
  pty?: { backend: string };
  models?: ModelHealth[];
  /** Chat models pulled on this machine that no route uses yet. */
  localModels?: Array<{ host: string; model: string; parameters: string | null }>;
  autopilot?: { running: string[]; queued: string[] };
};
export type SkillEvalSide = { runs: number; findings: number; passed: number; failed: number; verified: number; inputTokens: number; cachedTokens: number; outputTokens: number; usd: number | null };
export type SkillEvalSummary = { id: string; with: SkillEvalSide; without: SkillEvalSide; card: string; createdAt?: string; synthetic?: true; replay?: boolean };
export type SkillRecord = { id: string; name: string; description: string; roles: string[]; tags: string[]; origin: string; status: string; evidence: string[]; stale: boolean; appliedIn: string[]; helped: number; hurt: number; retireProposed: boolean; eval?: SkillEvalSummary };
export type PhaseGates = {
  phase2: { met: boolean; passPowK: number | null; k: number | null; tamperEscapes: number; detail: string };
  phase3: { met: boolean; tier: string | null; shadowDays: number; reverts: number; detail: string };
  golden: { k: number; passAt1: number; passPowK: number; tasks: number; usd: number | null } | null;
};
export type BenchMode = { runs: number; meanInputTokens: number; meanPromptTokens: number; meanUsd: number | null; passRate: number };
type BenchRun = { commit: string; startedAt: string; replay: boolean; synthetic?: true; implementer: string; continuer: string; models: Record<string, string>; rows: Array<{ task: string }>; byMode: Partial<Record<'transcript' | 'packet', BenchMode>> };
/** `stint bench` results, with the packet run that carried the diff digest when it was measured separately. */
export type BenchData = BenchRun & { digest: BenchRun | null };
export type QuizMiss ={ id: string; text: string; truth: boolean; blocking: boolean; answer: string };
export type QuizResult = {
  name: string;
  run: string;
  total: number;
  correct: number;
  score: number;
  blockingMisses: QuizMiss[];
  advisoryMisses: QuizMiss[];
  writer: { host: string; model: string; cost: Cost };
  answerer: { host: string; model: string; cost: Cost };
};
export type ModelHealth = { host: string; model: string; roles: string[]; ready: boolean; reason: string | null; offline: boolean };

export type RunSummary = {
  run: string;
  adapter: string | null;
  vendor: string | null;
  role: string | null;
  model: string | null;
  host: string | null;
  startedAt: string;
  endedAt: string | null;
  endedBy: string | null;
  cost: Cost | null;
  handoffFrom: string | null;
};

export type VerificationCheck = { name: string; kind: 'test' | 'typecheck' | 'lint' | 'custom'; exitCode: number; passed?: number; failed?: number; durationMs: number; status: 'green' | 'red' };
export type Verification = {
  run: string;
  command: string;
  exitCode: number;
  passed: number;
  failed: number;
  durationMs: number;
  runBy: 'daemon';
  status: 'green' | 'red';
  at: string;
  commit?: string;
  reason?: string;
  checks?: VerificationCheck[];
  tamper?: { files: string[]; allowedBy?: string } | null;
  scenarios?: { passed: number; failed: number; names: string[] } | null;
  coverage?: { base: number | null; branch: number | null } | null;
  coverageReason?: string;
};
/** A comment on one line of the diff; the daemon stores them and the next hand carries them in its ask. */
export type LineComment = { id: string; file: string; line: number; text: string; at: string; handedTo?: string };
export type MergeRecord = { commit: string; into: string | null; by: string | null; at: string; trailers: Record<string, string>; verificationHash: string | null };
export type OutcomeRecord = {
  kind: 'reverted' | 'followup' | 'ci' | 'incident';
  type: string;
  at: string;
  task: string;
  commit: string | null;
  mergeCommit: string | null;
  by: string | null;
  followup: string | null;
  files: string[];
  run: string | number | null;
  status: string | null;
  summary: string | null;
  url: string | null;
};
export type ReleaseRecord = { url: string | null; number: number | null; status: string | null };
/** A task's files: the live worktree when there is one, else its branch; `changed` is what its change touched. */
export type TaskFiles = { files: string[]; changed: Array<{ path: string; added: number; removed: number }>; worktree: string | null; ref: string; editable: boolean };

/** How one agent and model has done on one tag; `*` is every task (R-045). */
export type ScoreRow = { tag: string; agent: string; model: string | null; runs: number; attempts: number; passed: number; passRate: number | null; pass3: boolean | null; resolved: number; costPerResolved: number | null; reverts: number };

export type TaskBundle = { task: Task; plan: Plan | null; handoff: Handoff | null; review: Review | null; verification: Verification | null; runs: RunSummary[]; cost: Cost; merge?: MergeRecord | null; outcomes: OutcomeRecord[]; release?: ReleaseRecord | null; risk?: { tier: string; reasons: string[]; byPolicy: boolean } | null };

/** An issue pulled from GitHub or Linear and triaged, waiting for a person (R-041). */
export type IntakeItem = {
  id: string;
  source: 'github' | 'linear';
  ref: string;
  url: string | null;
  title: string;
  labels: string[];
  triage: { size: string; title: string; goal: string; acceptance: string[]; duplicates: string[]; risk: string; reason: string; model: string } | null;
  triageError?: string;
  state: 'open' | 'accepted' | 'merged' | 'dismissed';
  task: string | null;
};

/** Scheduled upkeep: each template, when it next makes a task, and the task it has open (R-044). */
export type Gardening = { schedule: 'off' | 'daily' | 'weekly'; templates: Array<{ id: string; title: string; lastAt: string | null; nextAt: string | null; openTask: string | null }> };

/** The auto-approve lane, its shadow record per tier, and whether each tier may be approved by policy (R-039). */
export type RiskState = {
  lane: { enabled: boolean; tiers: string[]; shadowDays: number };
  records: Array<{ tier: string; decisions: number; agreements: number; disagreements: number; revertsAfterWouldApprove: number; since: string | null; days: number }>;
  lanes: Array<{ tier: string; open: boolean; why: string }>;
};
export type AutopilotCard = { on: boolean; step: string | null; reason: string | null; queued: boolean };
export type TaskCardData = {
  task: Task;
  cost: Cost;
  lastRun: RunSummary | null;
  /** Every agent and model that worked on the task, in the order they first ran. */
  agents?: Array<{ adapter: string; host: string | null; model: string | null; role: string | null }>;
  lastEventAt: string;
  summary: string | null;
  autopilot?: AutopilotCard | null;
};
export type GraphNode = { id: string; type: string; label: string; data: Record<string, unknown> };
export type GraphEdge = { id: string; from: string; to: string; type: string; recordedAt: string; validTo: string | null; eventId: string; data: Record<string, unknown> };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; asOf: string | null; total: number };
export type PendingContradictionItem = {
  id: string;
  kind: 'contradiction';
  task: string;
  run: string;
  agent: string;
  decision: { id: string; text: string } | null;
  finding: { id: string; text: string; file?: string };
  at: string;
};
/** The adjudication queue beside contradictions (R-052): unsettled skill proposals and rename merges. */
export type PendingSkillItem = { id: string; kind: 'skill'; task: string; skill: string; run: string; agent: string; at: string };
export type PendingRenameItem = { id: string; kind: 'rename-merge'; task: string; run: string; agent: string; from: string; to: string; commit: string; at: string };
export type PendingItem = PendingContradictionItem | PendingSkillItem | PendingRenameItem;
/** One changed file, with the run behind each range of its new lines when blame could say (R-052). */
export type DiffBlameFile = { path: string; added: number; removed: number; hunks?: Array<{ start: number; end: number; run: string }> };
export type PermissionOptionData = { optionId: string; name: string; kind: string };
export type PendingPermission = { task: string; run: string; requestId: string; tool: string; title: string; options: PermissionOptionData[] };
export type CostRow = Cost & { key: string; runs: number; roles?: string[]; creditsLeft?: number; derived?: true };
export type DemoStatus = { playing: boolean; paused: boolean; at: number; total: number; title: string | null; live: boolean | null; recordedAt: string | null; done: boolean };
/** The board card summary: a local model's line when there is one, else the last agent message. */
export type TaskSummary = { summary: string; seq: number; source: 'model' | 'agent.message' | 'none'; host?: string; model?: string };
export type ApiError = { code: string; message: string; hint: unknown };

export class DaemonError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
  }
}

/** What went wrong in the daemon's own words, with its hint when it gives one; anything else as it was thrown. */
export function daemonMessage(e: unknown): string {
  if (!(e instanceof DaemonError)) return e instanceof Error ? e.message : String(e);
  const hint = e.error.hint;
  return `${e.error.message}${hint ? `. ${typeof hint === 'string' ? hint : JSON.stringify(hint)}` : ''}`;
}

/** The daemon serves the UI, so the API is same-origin. Vite's dev server proxies /api. */
const base = '';
let token: string | null = null;
try {
  token = localStorage.getItem('stint.token');
} catch {
  token = null;
}

export function setToken(t: string): void {
  token = t;
  try {
    localStorage.setItem('stint.token', t);
  } catch {
    /* private window: the token lasts for this tab only */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.method && init.method !== 'GET' && token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const isJson = res.headers.get('Content-Type')?.includes('application/json');
  if (!res.ok) {
    const body = isJson ? ((await res.json()) as { error: ApiError }) : { error: { code: 'invalid', message: await res.text(), hint: null } };
    throw new DaemonError(res.status, body.error);
  }
  return (isJson ? res.json() : res.text()) as Promise<T>;
}

/** The address of a task's terminal: same origin, with the daemon token as the query parameter. */
export function ptyUrl(id: string, client?: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const q = new URLSearchParams({ ...(token ? { token } : {}), ...(client ? { client } : {}) }).toString();
  return `${proto}//${location.host}${base}/api/tasks/${id}/pty${q ? `?${q}` : ''}`;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  health: () => request<Health>('/api/health'),
  tasks: () => request<{ tasks: TaskCardData[] }>('/api/tasks').then((r) => r.tasks),
  task: (id: string) => request<TaskBundle>(`/api/tasks/${id}`),
  events: (id: string, since = 0) => request<{ events: StintEvent[] }>(`/api/tasks/${id}/events?since=${since}`).then((r) => r.events),
  diff: (id: string) => request<string>(`/api/tasks/${id}/diff`),
  handoffNames: (id: string) => request<{ names: string[] }>(`/api/tasks/${id}/handoffs`).then((r) => r.names),
  handoff: (id: string, name: string) => request<{ name: string; packet: Handoff; meta: unknown }>(`/api/tasks/${id}/handoffs/${name}`),
  diffFiles: (id: string) => request<Array<{ path: string; added: number; removed: number }>>(`/api/tasks/${id}/diff?format=json`),
  diffBlame: (id: string) => request<DiffBlameFile[]>(`/api/tasks/${id}/diff?format=json&blame=1`),
  workspaceGraph: () => request<GraphData>('/api/graph'),
  comments: (id: string) => request<LineComment[]>(`/api/tasks/${id}/comments`),
  addComment: (id: string, comment: { file: string; line: number; text: string }) => post<LineComment[]>(`/api/tasks/${id}/comments`, comment),
  costs: (group: 'task' | 'run' | 'day' | 'host' | 'model' | 'day-host') => request<CostRow[]>(`/api/costs?group=${group}`),
  risk: () => request<RiskState>('/api/risk'),
  gardening: () => request<Gardening>('/api/gardening'),
  intake: () => request<IntakeItem[]>('/api/intake'),
  acceptIntake: (id: string) => post<{ task: string }>(`/api/intake/${id}/accept`),
  mergeIntake: (id: string, task: string) => post<{ task: string }>(`/api/intake/${id}/merge`, { task }),
  dismissIntake: (id: string) => post<{ state: string }>(`/api/intake/${id}/dismiss`),
  laneOff: () => post<{ enabled: false }>('/api/risk/autoapprove', { enabled: false }),
  scoreboard: () => request<{ rows: ScoreRow[]; routing: { mode: 'chains' | 'learned'; explore: number } }>('/api/scoreboard'),
  demoStatus: () => request<DemoStatus>('/api/demo/status'),
  createTask: (t: { title: string; goal: string; acceptance: string[]; testCommand?: string }) => post<Task>('/api/tasks', t),
  verify: (id: string) => post<Verification>(`/api/tasks/${id}/verify`),
  summary: (id: string) => post<TaskSummary>(`/api/tasks/${id}/summary`),
  files: (id: string) => request<TaskFiles>(`/api/tasks/${id}/files`),
  fileContent: (id: string, path: string) => request<{ path: string; content: string | null; reason?: string }>(`/api/tasks/${id}/files/content?path=${encodeURIComponent(path)}`),
  openInEditor: (id: string, path?: string, line?: number) => post<{ opened: string; with: string }>(`/api/tasks/${id}/open`, { ...(path ? { path } : {}), ...(line ? { line } : {}) }),
  verifications: (id: string) => request<Verification[]>(`/api/tasks/${id}/verification`),
  verificationOutput: (id: string, run: string) => request<string>(`/api/tasks/${id}/verification/${run}/output`),
  approve: (id: string) => post<unknown>(`/api/tasks/${id}/approve`),
  releaseRefresh: (id: string) => post<unknown>(`/api/tasks/${id}/release/refresh`),
  scanOutcomes: () => post<{ reverted: number; followup: number; ci: number }>('/api/outcomes/scan'),
  reject: (id: string, reason: string) => post<unknown>(`/api/tasks/${id}/reject`, { reason }),
  requestChanges: (id: string, text: string) => post<unknown>(`/api/tasks/${id}/request-changes`, { text }),
  graph: (id: string) => request<GraphData>(`/api/tasks/${id}/graph`),
  graphQuery: <T>(params: Record<string, string>) => request<T[]>(`/api/graph/query?${new URLSearchParams(params)}`),
  pending: () => request<PendingItem[]>('/api/graph/pending'),
  permissions: () => request<PendingPermission[]>('/api/permissions'),
  decidePermission: (id: string, run: string, requestId: string, optionId: string) => post<unknown>(`/api/tasks/${id}/runs/${run}/permission`, { requestId, optionId }),
  settle: (name: string, action: 'keep' | 'supersede') => post<unknown>(`/api/graph/pending/${name}`, { action }),
  skills: () => request<SkillRecord[]>('/api/skills'),
  approveSkill: (id: string) => post<unknown>(`/api/skills/${id}/approve`),
  rejectSkill: (id: string, reason: string) => post<unknown>(`/api/skills/${id}/reject`, { reason }),
  retireSkill: (id: string) => post<unknown>(`/api/skills/${id}/retire`),
  keepSkill: (id: string) => post<unknown>(`/api/skills/${id}/keep`),
  phaseGates: () => request<PhaseGates>('/api/phase-gates'),
  bench: () => request<BenchData>('/api/bench'),
  relay: () => request<import('./components/Relay').RelayData>('/api/relay'),
  metrics: (window: '7d' | '30d' | '90d' | 'all') => request<import('@stint-dev/core').Metrics>(`/api/metrics?window=${window}`),
  hand: (id: string, adapter: string, ask?: string) => post<{ run: string; packet: string }>(`/api/tasks/${id}/hand`, { adapter, ...(ask ? { ask } : {}) }),
  quiz: (id: string, name: string) => post<QuizResult>(`/api/tasks/${id}/handoffs/${name}/quiz`),
  stopRun: (id: string, run: string) => post<unknown>(`/api/tasks/${id}/runs/${run}/stop`),
  assign: (id: string, adapter: string) => post<{ run: string; worktree: string }>(`/api/tasks/${id}/assign`, { adapter, role: 'implementer' }),
  restoreCheckpoint: (id: string, run: string) => post<{ path: string; commit: string }>(`/api/tasks/${id}/runs/${run}/restore`, { what: 'code' }),
  autopilotAll: (on: boolean) => post<{ on: boolean; tasks: string[]; running: string[]; queued: string[] }>('/api/autopilot', { on }),
  autopilot: (id: string, on: boolean) => post<{ on: boolean; running: string[]; queued: string[] }>(`/api/tasks/${id}/autopilot`, { on }),
};

export type Unsubscribe = () => void;

type Subscriber = { onEvent: (e: StintEvent) => void; onFallback?: () => void };
type Stream = { es: EventSource; subscribers: Set<Subscriber>; poll: ReturnType<typeof setInterval> | null };
const streams = new Map<string, Stream>();

/**
 * Subscribes to an SSE route. Subscribers to the same route share one EventSource: a browser keeps about six
 * connections per host, and one stream per subscriber let two open tabs take them all and stall every request.
 * Every subscriber loads its starting state itself; the stream only brings what happens next. EventSource resumes
 * with Last-Event-ID on its own; when the stream cannot be opened at all, the subscribers' fallbacks poll once a second.
 */
export function subscribe(path: string, onEvent: (e: StintEvent) => void, onFallback?: () => void): Unsubscribe {
  let stream = streams.get(path);
  if (!stream) {
    const es = new EventSource(`${base}${path}`);
    const opened: Stream = { es, subscribers: new Set(), poll: null };
    es.onmessage = () => undefined;
    const handler = (m: MessageEvent<string>) => {
      let e: StintEvent;
      try {
        e = JSON.parse(m.data) as StintEvent;
      } catch {
        return; // heartbeat or partial frame
      }
      for (const s of opened.subscribers) s.onEvent(e);
    };
    // every event type arrives as its own SSE event name
    for (const t of EVENT_TYPES) es.addEventListener(t, handler as EventListener);
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED || opened.poll) return;
      opened.poll = setInterval(() => {
        for (const s of opened.subscribers) s.onFallback?.();
      }, 1000);
    };
    streams.set(path, opened);
    stream = opened;
  }
  const shared = stream;
  // an entry per call, so two subscribers passing the same function do not unsubscribe each other
  const me: Subscriber = { onEvent, ...(onFallback ? { onFallback } : {}) };
  shared.subscribers.add(me);
  return () => {
    shared.subscribers.delete(me);
    if (shared.subscribers.size > 0) return;
    shared.es.close();
    if (shared.poll) clearInterval(shared.poll);
    if (streams.get(path) === shared) streams.delete(path);
  };
}
