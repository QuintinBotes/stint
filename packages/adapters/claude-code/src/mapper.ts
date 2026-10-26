import type { AdapterEvent, Usage } from '@stint-dev/core';

// Claude Code headless stream-json, one JSON object per line (R-034).
// Format reference: https://code.claude.com/docs/en/headless
export type ClaudeRecord = {
  type?: string;
  subtype?: string;
  session_id?: string;
  message?: {
    content?: Array<Record<string, unknown>>;
    usage?: Record<string, unknown>;
  };
  result?: string;
  total_cost_usd?: number;
  usage?: Record<string, unknown>;
  is_error?: boolean;
};

const TEXT_CAP = 2048;
const cap = (s: string) => (s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)}...` : s);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Anthropic usage: inputTokens counts every prompt token, cached reads included (D-012). */
function readUsage(u: Record<string, unknown> | undefined): Usage | null {
  if (!u) return null;
  const cached = num(u.cache_read_input_tokens);
  const input = num(u.input_tokens) + cached + num(u.cache_creation_input_tokens);
  const output = num(u.output_tokens);
  if (input === 0 && output === 0 && cached === 0) return null;
  return { inputTokens: Math.round(input), cachedTokens: Math.round(cached), outputTokens: Math.round(output) };
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text' ? str((b as Record<string, unknown>).text) : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Maps Claude Code's stream-json lines onto Stint events, keeping the state a stream needs. */
export class ClaudeMapper {
  sessionId: string | null = null;
  usage: Usage | null = null;
  totalCostUsd: number | null = null;
  lastMessage = '';
  failed = false;
  private openCalls = new Map<string, string>();
  private turnUsage: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
  private sawTurnUsage = false;

  map(line: string): AdapterEvent[] {
    let rec: ClaudeRecord;
    try {
      rec = JSON.parse(line) as ClaudeRecord;
    } catch {
      return [{ type: 'runtime.unclassified', payload: { originalType: 'claude.unparsable', excerpt: cap(line.slice(0, 400)) } }];
    }
    if (rec.session_id) this.sessionId = rec.session_id;
    const out: AdapterEvent[] = [];
    switch (rec.type) {
      case 'system':
        // The init line names the session and model; it is not timeline content.
        return out;
      case 'assistant': {
        const turn = readUsage(rec.message?.usage);
        if (turn) {
          this.sawTurnUsage = true;
          this.turnUsage = {
            inputTokens: this.turnUsage.inputTokens + turn.inputTokens,
            cachedTokens: this.turnUsage.cachedTokens + turn.cachedTokens,
            outputTokens: this.turnUsage.outputTokens + turn.outputTokens,
          };
          if (!this.usage) this.usage = { ...this.turnUsage };
        }
        for (const block of rec.message?.content ?? []) {
          if (block.type === 'text') {
            const text = str(block.text).trim();
            if (text) {
              this.lastMessage = text;
              out.push({ type: 'agent.message', payload: { text: cap(text) } });
            }
          } else if (block.type === 'tool_use') {
            const callId = str(block.id) || `toolu-${this.openCalls.size + 1}`;
            const tool = str(block.name) || 'tool';
            this.openCalls.set(callId, tool);
            const args = block.input && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : {};
            out.push({ type: 'agent.tool_call', payload: { tool, args, callId } });
          }
        }
        return out;
      }
      case 'user': {
        for (const block of rec.message?.content ?? []) {
          if (block.type !== 'tool_result') continue;
          const callId = str(block.tool_use_id);
          const tool = this.openCalls.get(callId) ?? 'tool';
          this.openCalls.delete(callId);
          const text = resultText(block.content);
          out.push({
            type: 'agent.tool_result',
            payload: { tool, callId, ok: block.is_error !== true, summary: cap((text.split('\n')[0] ?? '').slice(0, 200)) },
          });
        }
        return out;
      }
      case 'result': {
        const final = readUsage(rec.usage);
        if (final) this.usage = final;
        else if (this.sawTurnUsage) this.usage = { ...this.turnUsage };
        if (typeof rec.total_cost_usd === 'number') this.totalCostUsd = rec.total_cost_usd;
        if (rec.is_error || (rec.subtype && rec.subtype !== 'success')) this.failed = true;
        const text = str(rec.result).trim();
        if (text && text !== this.lastMessage) {
          this.lastMessage = text;
          out.push({ type: 'agent.message', payload: { text: cap(text) } });
        } else if (text) {
          this.lastMessage = text;
        }
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
