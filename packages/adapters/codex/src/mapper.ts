import type { AdapterEvent, Usage } from '@stint-dev/core';

// Codex non-interactive JSONL, one JSON object per line (R-034).
// Format reference: https://developers.openai.com/codex/noninteractive
export type CodexRecord = {
  type?: string;
  thread_id?: string;
  usage?: Record<string, unknown>;
  error?: { message?: string } | string;
  message?: string;
  item?: Record<string, unknown> & { type?: string; id?: string };
};

const TEXT_CAP = 2048;
const cap = (s: string) => (s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)}...` : s);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const TOOL_ITEMS = new Set(['command_execution', 'file_change', 'mcp_tool_call']);

function toolName(item: Record<string, unknown>): string {
  if (item.type === 'mcp_tool_call') {
    const tool = str(item.tool) || str(item.name);
    const server = str(item.server);
    return server && tool ? `${server}/${tool}` : tool || 'mcp_tool_call';
  }
  return str(item.type) || 'tool';
}

function toolArgs(item: Record<string, unknown>): Record<string, unknown> {
  if (item.type === 'command_execution') return item.command ? { command: item.command } : {};
  if (item.type === 'file_change') return item.changes ? { changes: item.changes } : item.path ? { path: item.path } : {};
  if (item.type === 'mcp_tool_call') {
    const a = item.arguments;
    return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : a !== undefined ? { value: a } : {};
  }
  return {};
}

function toolSummary(item: Record<string, unknown>): string {
  if (item.type === 'command_execution') return (str(item.aggregated_output) || str(item.output)).split('\n')[0]?.slice(0, 200) ?? '';
  if (item.type === 'file_change') {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const paths = changes.map((c) => (c && typeof c === 'object' ? str((c as Record<string, unknown>).path) : '')).filter(Boolean);
    return paths.length ? paths.join(', ').slice(0, 200) : str(item.path).slice(0, 200);
  }
  if (item.type === 'mcp_tool_call') {
    const err = item.error;
    if (err) return (typeof err === 'string' ? err : JSON.stringify(err)).slice(0, 200);
    return (str(item.result) || str(item.output) || toolName(item)).split('\n')[0]?.slice(0, 200) ?? '';
  }
  return '';
}

function toolOk(item: Record<string, unknown>): boolean {
  if (typeof item.exit_code === 'number') return item.exit_code === 0;
  if (item.error) return false;
  const status = str(item.status);
  return status === '' || status === 'completed';
}

/** Maps Codex JSONL lines onto Stint events, keeping the state a stream needs. */
export class CodexMapper {
  threadId: string | null = null;
  usage: Usage | null = null;
  lastMessage = '';
  failed = false;
  private openCalls = new Map<string, string>();

  get sessionId(): string | null {
    return this.threadId;
  }

  map(line: string): AdapterEvent[] {
    let rec: CodexRecord;
    try {
      rec = JSON.parse(line) as CodexRecord;
    } catch {
      return [{ type: 'runtime.unclassified', payload: { originalType: 'codex.unparsable', excerpt: cap(line.slice(0, 400)) } }];
    }
    if (rec.thread_id) this.threadId = rec.thread_id;
    const out: AdapterEvent[] = [];
    switch (rec.type) {
      case 'thread.started':
      case 'turn.started':
        return out;
      case 'turn.completed': {
        if (rec.usage) {
          // OpenAI counts: input_tokens includes the cached ones (D-012).
          this.usage = {
            inputTokens: Math.round(num(rec.usage.input_tokens)),
            cachedTokens: Math.round(num(rec.usage.cached_input_tokens)),
            outputTokens: Math.round(num(rec.usage.output_tokens)),
          };
        }
        return out;
      }
      case 'turn.failed':
      case 'error': {
        this.failed = true;
        const message = typeof rec.error === 'string' ? rec.error : str(rec.error?.message) || str(rec.message) || 'Codex reported an error';
        out.push({ type: 'agent.message', payload: { text: cap(message), stderr: true } });
        return out;
      }
      case 'item.started': {
        const item = rec.item ?? {};
        if (item.type === 'agent_message') return out;
        if (!TOOL_ITEMS.has(str(item.type))) {
          return [{ type: 'runtime.unclassified', payload: { originalType: `codex.item.${str(item.type) || 'unknown'}`, excerpt: cap(JSON.stringify(rec).slice(0, 400)) } }];
        }
        const callId = str(item.id) || `item-${this.openCalls.size + 1}`;
        const tool = toolName(item);
        this.openCalls.set(callId, tool);
        out.push({ type: 'agent.tool_call', payload: { tool, args: toolArgs(item), callId } });
        return out;
      }
      case 'item.completed': {
        const item = rec.item ?? {};
        if (item.type === 'agent_message') {
          const text = str(item.text).trim();
          if (text) {
            this.lastMessage = text;
            out.push({ type: 'agent.message', payload: { text: cap(text) } });
          }
          return out;
        }
        if (!TOOL_ITEMS.has(str(item.type))) {
          return [{ type: 'runtime.unclassified', payload: { originalType: `codex.item.${str(item.type) || 'unknown'}`, excerpt: cap(JSON.stringify(rec).slice(0, 400)) } }];
        }
        const callId = str(item.id) || [...this.openCalls.keys()].at(-1) || 'item-unknown';
        const tool = this.openCalls.get(callId) ?? toolName(item);
        this.openCalls.delete(callId);
        out.push({ type: 'agent.tool_result', payload: { tool, callId, ok: toolOk(item), args: toolArgs(item), summary: cap(toolSummary(item)) } });
        return out;
      }
      default:
        return [{ type: 'runtime.unclassified', payload: { originalType: rec.type ?? 'unknown', excerpt: cap(JSON.stringify(rec).slice(0, 400)) } }];
    }
  }

  /** The last tool call with no result: what a kill interrupts. */
  inFlight(): string | null {
    return [...this.openCalls.values()].at(-1) ?? null;
  }
}
