import { join } from 'node:path';
import { type Host, hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import { type Cost, type StintEvent, renderHandoff } from '@stint-dev/core';
import { writeJsonAtomic } from '@stint-dev/core/node';
import { z } from 'zod';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { runSlice } from './handoff';
import { walkChain } from './route';

const Statement = z.strictObject({
  id: z.string().regex(/^S[0-9]+$/),
  text: z.string().min(1).max(240),
  truth: z.boolean(),
  blocking: z.boolean(),
});
const Facts = z.strictObject({ statements: z.array(Statement).min(3).max(10) });
const Answer = z.strictObject({ id: z.string(), answer: z.enum(['true', 'false', 'unknown']), quote: z.string().max(400) });
const Answers = z.strictObject({ answers: z.array(Answer) });

export type QuizMiss = { id: string; text: string; truth: boolean; blocking: boolean; answer: string };
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

const RECORD_CHARS = 20_000;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The run as a reader could reconstruct it: what the agent said and did, what changed, what the daemon found. */
export function renderRecord(events: StintEvent[]): string {
  const lines: string[] = [];
  for (const e of events) {
    const p = e.payload;
    if (e.type === 'run.started') lines.push(`run ${e.run} started: ${e.adapter} on ${p.model ?? 'its default model'}, role ${p.role}${p.handoffFrom ? `, from packet ${p.handoffFrom}` : ''}`);
    else if (e.type === 'agent.message') lines.push(`agent said: ${String(p.text ?? '').slice(0, 600)}`);
    else if (e.type === 'agent.tool_call') lines.push(`tool ${p.tool} ${JSON.stringify(p.args ?? {}).slice(0, 200)}`);
    else if (e.type === 'agent.tool_result' && p.ok === false) lines.push(`tool ${p.tool} failed: ${String(p.summary ?? '').slice(0, 200)}`);
    else if (e.type === 'file.changed') lines.push(`file ${p.path} +${p.added ?? 0} -${p.removed ?? 0}`);
    else if (e.type === 'decision.recorded') lines.push(`decision ${p.id}: ${p.text}`);
    else if (e.type === 'rule.blocked') lines.push(`refused: ${p.action} (${p.reason})`);
    else if (e.type === 'run.finished') lines.push(`run ended ${p.endedBy}${p.inFlight ? `, in flight: ${p.inFlight}` : ''}`);
    else if (e.type === 'verification.ran') lines.push(`daemon ran ${p.command}: ${p.passed} passed, ${p.failed} failed${Array.isArray(p.failing) && p.failing.length ? ` (${(p.failing as string[]).join('; ')})` : ''}`);
  }
  const text = lines.join('\n');
  // the end of a run matters most to the next agent, so a long record keeps its tail
  return text.length > RECORD_CHARS ? `[earlier events trimmed]\n${text.slice(-RECORD_CHARS)}` : text;
}

const writerPrompt = (task: string, record: string) => `You are checking whether a handoff packet is enough for the next coding agent.

Below is everything that happened in one run of task ${task}. Write 8 statements about facts the next agent needs to continue correctly: what was finished, what was not, which files changed, what the tests showed, what was refused, which decisions hold. Make about half of them true and half false; a false statement must be plausible, a near miss of the truth. Mark blocking true when an agent that believed the wrong answer would redo finished work, break something, or reverse a decision. Use only facts the record supports. Number them S1, S2 and so on.

Record:
${record}`;

const answererPrompt = (packet: string, statements: Array<{ id: string; text: string }>) => `You are the next coding agent. All you know about the work so far is this packet:

${packet}

For each statement, answer true or false from the packet, or unknown when the packet does not say. Quote the words in the packet that support your answer exactly as they appear; leave quote empty when the answer is unknown. Do not guess.

Statements:
${statements.map((s) => `${s.id}: ${s.text}`).join('\n')}`;

const hosts = (ctx: DaemonContext) => hostsFromConfig(ctx.ws.config) as Record<string, Host>;

/**
 * The packet fidelity quiz: one model writes true and false statements from the run's full record, another answers
 * them from the packet alone, and an answer counts only when it is right and quotes the packet. A miss on a blocking
 * statement is something the next agent would get wrong.
 */
export async function quizPacket(ctx: DaemonContext, taskId: string, name: string): Promise<QuizResult> {
  const store = ctx.ws.handoffs(taskId);
  const packet = await store.read(name);
  if (!packet) throw new DaemonError('not_found', `${taskId} has no packet ${name}`);
  const run = packet.from.run;
  const events = await ctx.ws.events(taskId).read();
  const { upto } = runSlice(events, run);
  const own = upto.filter((e) => e.run === run || (e.type === 'decision.recorded' && !e.run));
  const routes = ctx.ws.config.routes as { quiz?: string[]; recall?: string[]; planner: string[]; summary: string[] };
  const emit = (e: { type: string; payload: Record<string, unknown> }) => ctx.ws.events(taskId).append({ task: taskId, run, vendor: 'daemon', type: e.type, payload: e.payload }).then(() => undefined);

  const written = await walkChain<{ value: z.infer<typeof Facts> }>({
    role: 'planner',
    chain: routes.quiz ?? routes.planner,
    hosts: hosts(ctx),
    emit,
    call: (h, model, c) => h.complete(Facts, writerPrompt(taskId, renderRecord(own)), { model, timeoutMs: c.timeoutMs, emit: c.emit }),
  });
  const facts = ((written.value as { value?: z.infer<typeof Facts> }).value ?? written.value) as z.infer<typeof Facts>;
  const rendered = renderHandoff(packet);
  const answered = await walkChain<{ value: z.infer<typeof Answers> }>({
    role: 'reviewer',
    chain: routes.recall ?? routes.summary,
    hosts: hosts(ctx),
    emit,
    call: (h, model, c) => h.complete(Answers, answererPrompt(rendered, facts.statements.map(({ id, text }) => ({ id, text }))), { model, timeoutMs: c.timeoutMs, emit: c.emit }),
  });
  const answers = (((answered.value as { value?: z.infer<typeof Answers> }).value ?? answered.value) as z.infer<typeof Answers>).answers;

  const misses: QuizMiss[] = [];
  let correct = 0;
  const haystack = norm(rendered);
  for (const s of facts.statements) {
    const a = answers.find((x) => x.id === s.id);
    // a right answer counts only when it is grounded in the packet's own words
    const grounded = !!a && a.quote.trim().length > 0 && haystack.includes(norm(a.quote));
    if (a && a.answer === String(s.truth) && grounded) correct++;
    else misses.push({ id: s.id, text: s.text, truth: s.truth, blocking: s.blocking, answer: a ? (grounded || a.answer === 'unknown' ? a.answer : `${a.answer}, quote not in the packet`) : 'no answer' });
  }
  const total = facts.statements.length;
  const result: QuizResult = {
    name,
    run,
    total,
    correct,
    score: Math.round((correct / total) * 100) / 100,
    blockingMisses: misses.filter((m) => m.blocking),
    advisoryMisses: misses.filter((m) => !m.blocking),
    writer: { host: written.host, model: written.model, cost: written.cost },
    answerer: { host: answered.host, model: answered.model, cost: answered.cost },
  };
  await writeJsonAtomic(join(await ctx.ws.taskDir(taskId), 'handoffs', `${name}.quiz.json`), result);
  await ctx.ws.events(taskId).append({ task: taskId, run, vendor: 'daemon', type: 'handoff.quizzed', payload: { ...result }, links: [{ kind: 'handoff', ref: name }] });
  return result;
}
