// Typed client for the daemon. The daemon is the only writer of .stint/; the UI only reads and asks.
import type { Cost, Handoff, Plan, Review, StintEvent, Task } from '@stint-dev/core';

export type CapabilityLevel = { level: 'supported' | 'partial' | 'unsupported' | 'unknown'; reason?: string; note?: string };
export type AdapterHealth = { id: string; vendor: string; roles: string[]; capability: CapabilityLevel; gate: 'enforced' | 'observed' | 'none'; version?: string; reason?: string };
export type Health = {
  ok: boolean;
  version: string;
  mode: 'live' | 'replay';
  startedAt: string;
  adapters: AdapterHealth[];
  replay?: { title: string; recordedAt: string; live: boolean };
  pty?: { backend: string };
};

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

export type Verification = { run: string; command: string; exitCode: number; passed: number; failed: number; durationMs: number; runBy: 'daemon'; status: 'green' | 'red'; at: string };
export type TaskBundle = { task: Task; plan: Plan | null; handoff: Handoff | null; review: Review | null; verification: Verification | null; runs: RunSummary[]; cost: Cost };
export type TaskCardData = { task: Task; cost: Cost; lastRun: RunSummary | null; lastEventAt: string; summary: string | null };
export type CostRow = Cost & { key: string; runs: number };
export type DemoStatus = { playing: boolean; paused: boolean; at: number; total: number; title: string | null; live: boolean | null; recordedAt: string | null; done: boolean };
export type ApiError = { code: string; message: string; hint: unknown };

export class DaemonError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
  }
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
  costs: (group: 'task' | 'run' | 'day' | 'host') => request<CostRow[]>(`/api/costs?group=${group}`),
  demoStatus: () => request<DemoStatus>('/api/demo/status'),
  createTask: (t: { title: string; goal: string; acceptance: string[]; testCommand?: string }) => post<Task>('/api/tasks', t),
  verify: (id: string) => post<Verification>(`/api/tasks/${id}/verify`),
  approve: (id: string) => post<unknown>(`/api/tasks/${id}/approve`),
  reject: (id: string, reason: string) => post<unknown>(`/api/tasks/${id}/reject`, { reason }),
  requestChanges: (id: string, text: string) => post<unknown>(`/api/tasks/${id}/request-changes`, { text }),
};

export type Unsubscribe = () => void;

/**
 * Subscribes to an SSE route. EventSource resumes with Last-Event-ID on its own; when the stream cannot be
 * opened at all, `onFallback` polls once a second instead.
 */
export function subscribe(path: string, onEvent: (e: StintEvent) => void, onFallback?: () => void): Unsubscribe {
  let poll: ReturnType<typeof setInterval> | null = null;
  const es = new EventSource(`${base}${path}`);
  es.onmessage = () => undefined;
  const handler = (m: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(m.data) as StintEvent);
    } catch {
      /* heartbeat or partial frame */
    }
  };
  // every event type arrives as its own SSE event name
  const types = [
    'task.created', 'task.status', 'run.started', 'run.finished', 'run.refused', 'agent.message', 'agent.tool_call', 'agent.tool_result',
    'human.command', 'file.changed', 'decision.recorded', 'verification.ran', 'review.recorded', 'handoff.created', 'approval.requested',
    'approval.granted', 'approval.rejected', 'rule.blocked', 'skill.applied', 'skill.proposed', 'skill.approved', 'skill.rejected',
    'merge.completed', 'learn.skipped', 'provider.fallback', 'cost.unpriced', 'runtime.unclassified',
  ];
  for (const t of types) es.addEventListener(t, handler as EventListener);
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED && onFallback && !poll) poll = setInterval(onFallback, 1000);
  };
  return () => {
    es.close();
    if (poll) clearInterval(poll);
  };
}
