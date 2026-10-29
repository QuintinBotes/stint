// A fake agent that speaks the Agent Client Protocol on stdio, for the adapter's tests. FAKE_ACP_MODE picks the
// script: "full" (default) reads, writes, runs a terminal and asks permission; "outside" tries to write outside
// the worktree; "hang" asks permission and waits until it is cancelled; "kill" starts a long terminal command and kills it.
import { createInterface } from 'node:readline';

type Msg = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code: number; message: string } };
const mode = process.env.FAKE_ACP_MODE ?? 'full';
const send = (m: Msg) => process.stdout.write(`${JSON.stringify(m)}\n`);
let next = 1000;
const waiting = new Map<number | string, (m: Msg) => void>();
const ask = (method: string, params: Record<string, unknown>) =>
  new Promise<Msg>((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
const update = (sessionId: string, u: Record<string, unknown>) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } });
const say = (sessionId: string, text: string) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

let promptId: number | string | undefined;
let cancelled = false;

async function prompt(sessionId: string): Promise<string> {
  say(sessionId, 'Reading the package file. ');
  const read = await ask('fs/read_text_file', { sessionId, path: 'package.json', line: 1, limit: 3 });
  say(sessionId, `Read ${String((read.result as { content?: string })?.content ?? '').split('\n').length} lines.`);
  if (mode === 'kill') {
    const term = await ask('terminal/create', { sessionId, command: 'sleep', args: ['30'] });
    const terminalId = (term.result as { terminalId: string }).terminalId;
    await ask('terminal/kill', { sessionId, terminalId });
    const exit = (await ask('terminal/wait_for_exit', { sessionId, terminalId })).result as { exitCode: number | null; signal: string | null };
    const output = (await ask('terminal/output', { sessionId, terminalId })).result as { exitStatus?: { signal: string | null } };
    await ask('terminal/release', { sessionId, terminalId });
    say(sessionId, ` The terminal ended by ${exit.signal} with exit code ${exit.exitCode}; its output says ${output.exitStatus?.signal}.`);
    return 'end_turn';
  }
  if (mode === 'outside') {
    const out = await ask('fs/write_text_file', { sessionId, path: '../outside.txt', content: 'escaped' });
    say(sessionId, out.error ? ` The write was refused: ${out.error.message}.` : ' The write went through.');
    return 'end_turn';
  }
  update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Write the limiter', kind: 'edit', status: 'pending', rawInput: { path: 'src/lib/acp.ts' } });
  await ask('fs/write_text_file', { sessionId, path: 'src/lib/acp.ts', content: 'export const FROM_ACP = true;\n' });
  update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'wrote src/lib/acp.ts' } }] });
  const term = await ask('terminal/create', { sessionId, command: 'echo', args: ['hi'] });
  const terminalId = (term.result as { terminalId: string }).terminalId;
  await ask('terminal/wait_for_exit', { sessionId, terminalId });
  const output = await ask('terminal/output', { sessionId, terminalId });
  await ask('terminal/release', { sessionId, terminalId });
  say(sessionId, ` The terminal said: ${String((output.result as { output?: string })?.output ?? '').trim()}.`);
  const answer = await ask('session/request_permission', {
    sessionId,
    toolCall: { toolCallId: 't2', title: 'Run the test suite', kind: 'execute' },
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'always', name: 'Always', kind: 'allow_always' },
      { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
    ],
  });
  const outcome = (answer.result as { outcome?: { outcome: string; optionId?: string } })?.outcome;
  if (cancelled || outcome?.outcome === 'cancelled') return 'cancelled';
  say(sessionId, outcome?.optionId === 'deny' ? ' Not allowed, so I stopped.' : ` Allowed (${outcome?.optionId}).`);
  return 'end_turn';
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const m = JSON.parse(line) as Msg;
  if (m.id !== undefined && !m.method) {
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
    return;
  }
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  else if (m.method === 'session/new') send({ jsonrpc: '2.0', id: m.id, result: { sessionId: 'sess-1' } });
  else if (m.method === 'session/prompt') {
    promptId = m.id;
    void prompt('sess-1').then((stopReason) => {
      if (!cancelled) send({ jsonrpc: '2.0', id: promptId, result: { stopReason } });
    });
  } else if (m.method === 'session/cancel') {
    cancelled = true;
    send({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'cancelled' } });
    setTimeout(() => process.exit(0), 20);
  } else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `no ${m.method}` } });
});
