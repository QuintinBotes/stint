import type { AdapterEvent, Usage } from '@stint-dev/core';

/** One line of `muse exec --json`: an MSP record (see `muse schema generate-json-schema`). */
export type MuseRecord = {
  stream?: { kind: string; id: string };
  sequence?: number;
  payload_type: string;
  payload: Record<string, unknown> & { event?: Record<string, unknown> };
};

export type MuseTerminal = { kind: 'completed' | 'failed' | 'cancelled' | string; reason: string | null; text: string };

/**
 * Records that carry nothing a person needs on the timeline. They stay in transcript.jsonl for audit;
 * anything not listed here and not mapped becomes `runtime.unclassified`, never dropped.
 */
const QUIET = new Set([
  'task.stream.linked',
  'task.lifecycle.accepted',
  'task.lifecycle.scheduled',
  'task.lifecycle.completed',
  'task.lifecycle.status',
  'task.lifecycle.output',
  'task.lifecycle.tool_output_ref',
  'runtime.command.accepted',
  'session.run.linked',
  'session.workspace_branch.observed',
  'run.model.configured',
  'run.lifecycle.started',
  'turn.input.user',
  'todo.snapshot.updated',
]);

const TEXT_CAP = 2048;
const cap = (s: string) => (s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)}...` : s);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

type ToolTask = { tool: string; callId?: string; started: boolean };

/** What a tool result says about the call it answers: the path or the command, for the timeline. */
function argsFromResult(tool: string, text: string, editFacts: unknown): Record<string, unknown> {
  const ef = editFacts as { path?: string; added?: number; removed?: number } | null;
  if (ef?.path) return { path: ef.path };
  if (tool === 'bash') {
    try {
      const j = JSON.parse(text) as { command?: string };
      if (j.command) return { command: j.command };
    } catch {
      /* not the JSON bash result */
    }
  }
  const read = /^Read text file `([^`]+)`/.exec(text);
  if (read?.[1]) return { path: read[1] };
  return {};
}

/** Maps Muse Code's JSONL event stream one to one onto Stint events, keeping the state a stream needs. */
export class MuseMapper {
  sessionId: string | null = null;
  usage: Usage | null = null;
  terminal: MuseTerminal | null = null;
  private tasks = new Map<string, ToolTask>();
  private openCalls = new Map<string, string>();
  private text = '';

  map(line: string): AdapterEvent[] {
    let rec: MuseRecord;
    try {
      rec = JSON.parse(line) as MuseRecord;
    } catch {
      return [{ type: 'runtime.unclassified', payload: { originalType: 'muse.unparsable', excerpt: cap(line.slice(0, 400)) } }];
    }
    if (!this.sessionId && rec.stream?.kind === 'session') this.sessionId = rec.stream.id;
    const p = rec.payload ?? {};
    const e = (p.event ?? {}) as Record<string, unknown>;
    const out: AdapterEvent[] = [];
    switch (rec.payload_type) {
      case 'task.lifecycle.proposed': {
        const kind = str(e.task_kind);
        if (kind.startsWith('tool.')) this.tasks.set(str(e.task_id), { tool: kind.slice(5), started: false });
        return out;
      }
      case 'task.lifecycle.side_effect_intent': {
        const t = this.tasks.get(str(e.task_id));
        const key = str(e.idempotency_key);
        if (t && key.startsWith('tool:')) t.callId = key.slice(5);
        return out;
      }
      case 'task.lifecycle.started': {
        const t = this.tasks.get(str(e.task_id));
        if (!t || t.started) return out;
        t.started = true;
        out.push(...this.flushText());
        const callId = t.callId ?? str(e.task_id);
        this.openCalls.set(callId, t.tool);
        out.push({ type: 'agent.tool_call', payload: { tool: t.tool, args: {}, callId } });
        return out;
      }
      case 'tool.result': {
        const callId = str(p.call_id);
        const tool = this.openCalls.get(callId) ?? 'tool';
        this.openCalls.delete(callId);
        const text = str(p.text);
        const ef = p.edit_facts as { added?: number; removed?: number } | null;
        out.push({
          type: 'agent.tool_result',
          payload: {
            tool,
            callId,
            ok: true,
            args: argsFromResult(tool, text, p.edit_facts),
            summary: cap((text.split('\n')[0] ?? '').slice(0, 200)),
            ...(ef?.added !== undefined ? { added: ef.added } : {}),
            ...(ef?.removed !== undefined ? { removed: ef.removed } : {}),
          },
        });
        return out;
      }
      case 'task.lifecycle.rejected': {
        const t = this.tasks.get(str(e.task_id));
        if (t?.started && t.callId) {
          this.openCalls.delete(t.callId);
          out.push({ type: 'agent.tool_result', payload: { tool: t.tool, callId: t.callId, ok: false, summary: `rejected: ${str(e.reason)}` } });
        }
        return out;
      }
      case 'run.output.delta':
        this.text += str(p.text);
        return out;
      case 'run.usage': {
        const models = (p.models ?? []) as Array<{ input_tokens?: number; cached_tokens?: number; output_tokens?: number }>;
        this.usage = models.reduce<Usage>(
          (u, m) => ({ inputTokens: u.inputTokens + (m.input_tokens ?? 0), cachedTokens: u.cachedTokens + (m.cached_tokens ?? 0), outputTokens: u.outputTokens + (m.output_tokens ?? 0) }),
          { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
        );
        return out;
      }
      default:
        if (rec.payload_type.startsWith('run.terminal.')) {
          this.terminal = { kind: rec.payload_type.slice('run.terminal.'.length), reason: (p.reason as string | null) ?? null, text: str(p.text) };
          if (!this.text && this.terminal.text) this.text = this.terminal.text;
          out.push(...this.flushText());
          return out;
        }
        if (QUIET.has(rec.payload_type)) return out;
        return [{ type: 'runtime.unclassified', payload: { originalType: rec.payload_type, excerpt: cap(JSON.stringify(p).slice(0, 400)) } }];
    }
  }

  /** Text streamed since the last tool call, as one message. */
  flushText(): AdapterEvent[] {
    const text = this.text.trim();
    this.text = '';
    return text ? [{ type: 'agent.message', payload: { text: cap(text) } }] : [];
  }

  /** The last tool call with no result: what a kill interrupts. Muse reports arguments only with results. */
  inFlight(): string | null {
    const last = [...this.openCalls.values()].at(-1);
    return last ?? null;
  }
}
