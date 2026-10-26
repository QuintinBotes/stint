/** One tool result is kept up to this many characters; everything else is kept whole. */
const TOOL_RESULT_CAP = 4096;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function capToolResult(text: string): string {
  return text.length > TOOL_RESULT_CAP ? `${text.slice(0, TOOL_RESULT_CAP)}\n[tool result truncated at 4 KB]` : text;
}

/** Tool call arguments as readable text: JSON arguments are parsed and printed, never summarised. */
function formatArgs(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw === 'string') {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return JSON.stringify(raw, null, 2);
}

/** What a Muse tool result says about the call it answers: the path or the command. */
function argsFromMuseResult(tool: string, text: string, editFacts: unknown): Record<string, unknown> {
  const ef = obj(editFacts);
  if (typeof ef.path === 'string') return { path: ef.path };
  if (tool === 'bash') {
    try {
      const j = obj(JSON.parse(text));
      if (typeof j.command === 'string') return { command: j.command };
    } catch {
      /* not the JSON bash result */
    }
  }
  const read = /^Read text file `([^`]+)`/.exec(text);
  if (read?.[1]) return { path: read[1] };
  return {};
}

/** Muse Code MSP records that carry no message, call or result text; the tool result line carries the output chunks. */
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
  'todo.snapshot.updated',
  'run.usage',
]);

type Blocks = {
  blocks: string[];
  pendingText: string;
  toolByTask: Map<string, string>;
  callByTask: Map<string, string>;
  startedTasks: Set<string>;
  /** Index of the tool call block per call id, so a later result can add the arguments Muse only reports then. */
  callBlock: Map<string, number>;
  toolByCall: Map<string, string>;
};

function flushText(s: Blocks): void {
  const text = s.pendingText.trim();
  s.pendingText = '';
  if (text) s.blocks.push(`Assistant: ${text}`);
}

function renderOpenAiBody(body: Record<string, unknown>, blocks: string[]): boolean {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  if (choices.length === 0) return false;
  for (const choice of choices) {
    const message = obj(obj(choice).message);
    const content = str(message.content).trim();
    if (content) blocks.push(`Assistant: ${content}`);
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const call of calls) {
      const fn = obj(obj(call).function);
      const name = str(fn.name) || 'tool';
      const args = formatArgs(fn.arguments);
      blocks.push(args ? `Tool call: ${name} ${args}` : `Tool call: ${name}`);
    }
  }
  return true;
}

function renderMuseLine(rec: Record<string, unknown>, s: Blocks): boolean {
  const type = str(rec.payload_type);
  if (!type) return false;
  const p = obj(rec.payload);
  const e = obj(p.event);
  switch (type) {
    case 'turn.input.user': {
      const prompt = str(p.prompt).trim();
      if (prompt) s.blocks.push(`User: ${prompt}`);
      return true;
    }
    case 'run.output.delta':
      s.pendingText += str(p.text);
      return true;
    case 'task.lifecycle.proposed': {
      const kind = str(e.task_kind);
      if (kind.startsWith('tool.')) s.toolByTask.set(str(e.task_id), kind.slice(5));
      return true;
    }
    case 'task.lifecycle.side_effect_intent': {
      const key = str(e.idempotency_key);
      if (s.toolByTask.has(str(e.task_id)) && key.startsWith('tool:')) s.callByTask.set(str(e.task_id), key.slice(5));
      return true;
    }
    case 'task.lifecycle.started': {
      const taskId = str(e.task_id);
      const tool = s.toolByTask.get(taskId);
      if (!tool || s.startedTasks.has(taskId)) return true;
      s.startedTasks.add(taskId);
      flushText(s);
      const callId = s.callByTask.get(taskId) ?? taskId;
      s.callBlock.set(callId, s.blocks.length);
      s.toolByCall.set(callId, tool);
      s.blocks.push(`Tool call: ${tool}`);
      return true;
    }
    case 'tool.result': {
      const callId = str(p.call_id);
      const tool = s.toolByCall.get(callId) ?? str(obj(p.correlation_facts).tool_name) ?? 'tool';
      const text = str(p.text);
      const args = argsFromMuseResult(tool || 'tool', text, p.edit_facts);
      const at = s.callBlock.get(callId);
      if (at !== undefined && Object.keys(args).length > 0) {
        s.blocks[at] = `Tool call: ${tool || 'tool'} ${formatArgs(args)}`;
      }
      s.blocks.push(`Tool result (${tool || 'tool'}):\n${capToolResult(text)}`);
      return true;
    }
    case 'task.lifecycle.rejected': {
      const taskId = str(e.task_id);
      const tool = s.toolByTask.get(taskId);
      if (tool && s.startedTasks.has(taskId)) s.blocks.push(`Tool result (${tool}): rejected: ${str(e.reason)}`);
      return true;
    }
    default: {
      if (type.startsWith('run.terminal.')) {
        if (!s.pendingText && str(p.text)) s.pendingText = str(p.text);
        flushText(s);
        return true;
      }
      if (QUIET.has(type)) return true;
      return false;
    }
  }
}

/**
 * Renders recorded transcript lines as readable text, the way a tool that resumes from the log would
 * feed them to the next agent: user and model messages, tool calls with their arguments, and tool
 * results in order. Handles Muse Code MSP JSONL lines and Stint agent response lines. Nothing is
 * summarised; only a single tool result is capped at 4 KB.
 */
export function renderTranscript(lines: string[]): string {
  const s: Blocks = { blocks: [], pendingText: '', toolByTask: new Map(), callByTask: new Map(), startedTasks: new Set(), callBlock: new Map(), toolByCall: new Map() };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: Record<string, unknown>;
    try {
      rec = obj(JSON.parse(trimmed));
    } catch {
      flushText(s);
      s.blocks.push(trimmed);
      continue;
    }
    if (Object.keys(rec).length === 0) {
      s.blocks.push(trimmed);
      continue;
    }
    // Stint agent line: { kind: 'response', host, model, body: <chat completion> }
    if (rec.kind === 'response' && renderOpenAiBody(obj(rec.body), s.blocks)) continue;
    // A bare chat completion body.
    if (renderOpenAiBody(rec, s.blocks)) continue;
    // A single chat message (a tool role message is a tool result).
    if (typeof rec.role === 'string' && (typeof rec.content === 'string' || Array.isArray(rec.tool_calls))) {
      const role = rec.role;
      const content = str(rec.content);
      if (role === 'tool') {
        s.blocks.push(`Tool result:\n${capToolResult(content)}`);
      } else if (content.trim()) {
        s.blocks.push(`${role === 'assistant' ? 'Assistant' : role === 'user' ? 'User' : role}: ${content.trim()}`);
      }
      const calls = Array.isArray(rec.tool_calls) ? rec.tool_calls : [];
      for (const call of calls) {
        const fn = obj(obj(call).function);
        const args = formatArgs(fn.arguments);
        s.blocks.push(args ? `Tool call: ${str(fn.name) || 'tool'} ${args}` : `Tool call: ${str(fn.name) || 'tool'}`);
      }
      continue;
    }
    if (renderMuseLine(rec, s)) continue;
    // Anything else is kept as it was recorded, never dropped.
    flushText(s);
    s.blocks.push(trimmed);
  }
  flushText(s);
  return s.blocks.join('\n\n');
}
