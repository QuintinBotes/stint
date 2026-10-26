import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, runsFromEvents } from '@stint-dev/core/node';
import { startDaemon } from '@stint-dev/daemon';
import { otelExport } from '../src/otel';

type Attr = { key: string; value: Record<string, unknown> };
type Span = { traceId: string; spanId: string; parentSpanId?: string; name: string; attributes: Attr[]; events: Array<{ name: string }> };
const attr = (s: Span, key: string) => {
  const v = s.attributes.find((a) => a.key === key)?.value;
  return v ? (v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue) : undefined;
};

test('stint otel export T-0042 on the replay writes spans whose attributes carry model and token counts, one span per run and tool call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stint-otel-'));
  try {
    expect(Bun.spawnSync(['git', 'clone', '-q', join(import.meta.dir, '..', '..', '..', 'demo', 'repo.bundle'), root]).exitCode).toBe(0);
    const d = await startDaemon({ root, quiet: true });
    try {
      const play = await fetch(`${d.url}/api/demo/play`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ speed: 0 }) });
      expect(play.status).toBe(202);
      while (((await (await fetch(`${d.url}/api/demo/status`)).json()) as { playing: boolean }).playing) await Bun.sleep(50);
    } finally {
      await d.stop();
    }
    const out = join(root, 'trace.json');
    const r = await otelExport(root, 'T-0042', out);
    const body = JSON.parse(readFileSync(out, 'utf8')) as { resourceSpans: Array<{ resource: { attributes: Attr[] }; scopeSpans: Array<{ spans: Span[] }> }> };
    const spans = body.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
    expect(r.spans).toBe(spans.length);

    const events = await (await Workspace.open(root)).events('T-0042').read();
    const runs = runsFromEvents(events).filter((x) => x.endedAt);
    const calls = events.filter((e) => e.type === 'agent.tool_call');
    const runSpans = spans.filter((s) => s.name.startsWith('invoke_agent ') || s.name.startsWith('chat '));
    const toolSpans = spans.filter((s) => s.name.startsWith('execute_tool '));
    const task = spans.find((s) => s.name === 'task T-0042') as Span;
    expect(runSpans).toHaveLength(runs.length);
    expect(toolSpans).toHaveLength(calls.length);
    expect(spans).toHaveLength(runs.length + calls.length + 1);

    // one trace; runs hang from the task, tool calls from their run
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    expect(spans[0]?.traceId).toMatch(/^[0-9a-f]{32}$/);
    for (const s of runSpans) expect(s.parentSpanId).toBe(task.spanId);
    const runIds = new Set(runSpans.map((s) => s.spanId));
    for (const s of toolSpans) expect(runIds.has(s.parentSpanId as string)).toBe(true);

    const built = runSpans.find((s) => attr(s, 'gen_ai.agent.name') === 'muse-code') as Span;
    expect(attr(built, 'gen_ai.operation.name')).toBe('invoke_agent');
    expect(attr(built, 'gen_ai.request.model')).toBe('muse-spark-1.3');
    expect(Number(attr(built, 'gen_ai.usage.input_tokens'))).toBeGreaterThan(0);
    expect(Number(attr(built, 'gen_ai.usage.output_tokens'))).toBeGreaterThan(0);
    expect(runSpans.some((s) => s.events.some((e) => e.name === 'stint.verification'))).toBe(true);
    expect(toolSpans.every((s) => typeof attr(s, 'gen_ai.tool.name') === 'string')).toBe(true);
    expect(body.resourceSpans[0]?.resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'stint' } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
