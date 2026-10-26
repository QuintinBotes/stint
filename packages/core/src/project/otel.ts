// OpenTelemetry spans from a task's log (R-043), so Langfuse, Braintrust or any OTLP collector can read Stint's
// runs. A task is a trace, each run a span under the task's span, each tool call a span under its run. Names and
// attributes follow the GenAI semantic conventions; verification, review and eval results are span events.
import { createHash } from 'node:crypto';
import type { StintEvent } from '../schemas/event';
import type { Task } from '../schemas/task';
import { runsFromEvents } from './index';

type AnyValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean } | { arrayValue: { values: AnyValue[] } };
export type OtlpAttribute = { key: string; value: AnyValue };
export type OtlpEvent = { timeUnixNano: string; name: string; attributes: OtlpAttribute[] };
export type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  events: OtlpEvent[];
  status: { code: number; message?: string };
};

const SPAN_INTERNAL = 1;
const SPAN_CLIENT = 3;
const STATUS_UNSET = 0;
const STATUS_OK = 1;
const STATUS_ERROR = 2;

const hex = (s: string, n: number) => createHash('sha256').update(s).digest('hex').slice(0, n);
export const traceIdOf = (task: Task) => hex(`stint:${task.id}:${task.createdAt}`, 32);
const taskSpanId = (task: Task) => hex(`task:${task.id}:${task.createdAt}`, 16);
const runSpanId = (task: Task, run: string) => hex(`run:${task.id}:${task.createdAt}/${run}`, 16);
const toolSpanId = (task: Task, run: string, call: string) => hex(`tool:${task.id}:${task.createdAt}/${run}/${call}`, 16);
const nanos = (iso: string) => (BigInt(Date.parse(iso)) * 1_000_000n).toString();

/** Attributes from a plain object; null and undefined are left out, as OTLP has no null. */
function attrs(o: Record<string, unknown>): OtlpAttribute[] {
  const out: OtlpAttribute[] = [];
  for (const [key, v] of Object.entries(o)) {
    const value = anyValue(v);
    if (value) out.push({ key, value });
  }
  return out;
}

function anyValue(v: unknown): AnyValue | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(anyValue).filter((x): x is AnyValue => x !== null) } };
  return { stringValue: JSON.stringify(v) };
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The span events a run carries: what the daemon judged about it. */
function runEvents(events: StintEvent[], run: string): OtlpEvent[] {
  const out: OtlpEvent[] = [];
  for (const e of events) {
    if (e.run !== run) continue;
    const p = e.payload;
    if (e.type === 'verification.ran') out.push({ timeUnixNano: nanos(e.ts), name: 'stint.verification', attributes: attrs({ 'stint.verification.status': str(p.status), 'stint.verification.passed': num(p.passed), 'stint.verification.failed': num(p.failed), 'stint.verification.command': str(p.command) }) });
    else if (e.type === 'review.recorded') out.push({ timeUnixNano: nanos(e.ts), name: 'stint.review', attributes: attrs({ 'stint.review.verdict': str(p.verdict), 'stint.review.findings': num(p.findings), 'stint.review.lens': str(p.lens) }) });
    else if (e.type === 'handoff.created') out.push({ timeUnixNano: nanos(e.ts), name: 'stint.handoff', attributes: attrs({ 'stint.handoff.name': str(p.name), 'stint.handoff.tokens': num(p.tokens), 'stint.handoff.hash': str(p.hash) }) });
    else if (e.type === 'rule.blocked') out.push({ timeUnixNano: nanos(e.ts), name: 'stint.refused', attributes: attrs({ 'stint.refused.action': str(p.action), 'stint.refused.reason': str(p.reason), 'stint.refused.by': str(p.by) }) });
    else if (e.type === 'provider.fallback') out.push({ timeUnixNano: nanos(e.ts), name: 'stint.fallback', attributes: attrs({ 'stint.fallback.from': str(p.from), 'stint.fallback.to': str(p.to), 'stint.fallback.reason': str(p.reason) }) });
  }
  return out;
}

/**
 * The spans of one task: the task's own span (once it has ended, or when asked), every run, and every tool call.
 * `only` limits it to one run and its tool calls, for the exporter at the end of that run.
 */
export function taskSpans(task: Task, events: StintEvent[], o: { only?: string; withTask?: boolean; runs?: boolean } = {}): OtlpSpan[] {
  const traceId = traceIdOf(task);
  const spans: OtlpSpan[] = [];
  const last = events.at(-1)?.ts ?? task.updatedAt;
  for (const r of o.runs === false ? [] : runsFromEvents(events)) {
    if (o.only && r.run !== o.only) continue;
    if (!r.endedAt) continue;
    const started = events.find((e) => e.type === 'run.started' && e.run === r.run);
    const finished = events.filter((e) => e.type === 'run.finished' && e.run === r.run).at(-1);
    const model = str(finished?.payload.model) ?? r.model ?? undefined;
    const isModelCall = r.adapter === 'openai-compatible';
    const operation = isModelCall ? 'chat' : 'invoke_agent';
    spans.push({
      traceId,
      spanId: runSpanId(task, r.run),
      parentSpanId: taskSpanId(task),
      name: isModelCall ? `chat ${model ?? r.role ?? 'model'}` : `invoke_agent ${r.adapter ?? 'agent'}`,
      kind: isModelCall ? SPAN_CLIENT : SPAN_INTERNAL,
      startTimeUnixNano: nanos(r.startedAt),
      endTimeUnixNano: nanos(r.endedAt),
      attributes: attrs({
        'gen_ai.operation.name': operation,
        'gen_ai.system': r.vendor ?? undefined,
        'gen_ai.provider.name': r.host ?? r.vendor ?? undefined,
        'gen_ai.request.model': r.model ?? model,
        'gen_ai.response.model': model,
        'gen_ai.agent.name': isModelCall ? undefined : (r.adapter ?? undefined),
        'gen_ai.usage.input_tokens': r.cost?.inputTokens,
        'gen_ai.usage.output_tokens': r.cost?.outputTokens,
        'stint.usage.cached_tokens': r.cost?.cachedTokens,
        'stint.cost.usd': r.cost?.usd ?? undefined,
        'stint.cost.estimated': r.cost?.estimated,
        'stint.task': task.id,
        'stint.run': r.run,
        'stint.role': r.role ?? undefined,
        'stint.host': r.host ?? undefined,
        'stint.ended_by': r.endedBy ?? undefined,
        'stint.handoff_from': r.handoffFrom ?? undefined,
        'stint.adopted_from': str(started?.payload.adoptedFrom),
      }),
      events: runEvents(events, r.run),
      status: r.endedBy === 'failed' ? { code: STATUS_ERROR, message: 'the run failed' } : r.endedBy === 'completed' ? { code: STATUS_OK } : { code: STATUS_UNSET },
    });
    const calls = events.filter((e) => e.run === r.run && e.type === 'agent.tool_call');
    for (const [i, call] of calls.entries()) {
      const id = str(call.payload.callId) ?? `${i}`;
      const result = events.find((e) => e.run === r.run && e.type === 'agent.tool_result' && str(e.payload.callId) === id && e.ts >= call.ts);
      const tool = str(call.payload.tool) ?? 'tool';
      spans.push({
        traceId,
        spanId: toolSpanId(task, r.run, `${id}:${i}`),
        parentSpanId: runSpanId(task, r.run),
        name: `execute_tool ${tool}`,
        kind: SPAN_INTERNAL,
        startTimeUnixNano: nanos(call.ts),
        endTimeUnixNano: nanos(result?.ts ?? r.endedAt),
        attributes: attrs({
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': tool,
          'gen_ai.tool.call.id': id,
          'stint.tool.ok': typeof result?.payload.ok === 'boolean' ? result.payload.ok : undefined,
          'stint.tool.summary': str(result?.payload.summary)?.slice(0, 200),
        }),
        events: [],
        status: result ? (result.payload.ok === false ? { code: STATUS_ERROR } : { code: STATUS_OK }) : { code: STATUS_UNSET, message: 'no result: in flight when the run ended' },
      });
    }
  }
  if (o.withTask) {
    const outcome = (e: StintEvent) => e.type === 'merge.completed' || e.type === 'approval.granted' || e.type === 'approval.rejected' || e.type.startsWith('outcome.');
    const evals = (e: StintEvent) => e.type === 'eval.ran' || e.type === 'skill.evaluated' || e.type === 'handoff.quizzed';
    spans.push({
      traceId,
      spanId: taskSpanId(task),
      name: `task ${task.id}`,
      kind: SPAN_INTERNAL,
      startTimeUnixNano: nanos(task.createdAt),
      endTimeUnixNano: nanos(last),
      attributes: attrs({ 'stint.task': task.id, 'stint.task.title': task.title, 'stint.task.status': task.status, 'stint.task.tags': task.tags ?? [] }),
      events: events
        .filter((e) => outcome(e) || evals(e))
        .map((e) => ({ timeUnixNano: nanos(e.ts), name: `stint.${e.type}`, attributes: attrs(Object.fromEntries(Object.entries(e.payload).filter(([, v]) => typeof v !== 'object' || Array.isArray(v)).map(([k, v]) => [`stint.${k}`, v]))) })),
      status: task.status === 'done' ? { code: STATUS_OK } : task.status === 'rejected' ? { code: STATUS_ERROR, message: 'rejected' } : { code: STATUS_UNSET },
    });
  }
  return spans;
}

/** The OTLP/HTTP JSON body for a batch of spans. */
export function otlpBody(spans: OtlpSpan[], serviceName: string, version: string): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: { attributes: attrs({ 'service.name': serviceName, 'service.version': version }) },
        scopeSpans: [{ scope: { name: 'stint', version }, spans }],
      },
    ],
  };
}
