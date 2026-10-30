import { type StintEvent, modelName } from '@stint-dev/core';
import { defineCommand } from 'citty';
import { daemonFor, getDaemon } from './client';
import { repoRoot } from './repo';
import { readSSE } from './sse';

const repoArg = { repo: { type: 'string', description: 'Repository root (default: the git top level)' } } as const;

const AGENTS: Record<string, string> = { 'muse-code': 'Muse Code', 'stint-agent': 'Stint agent', 'claude-code': 'Claude Code', codex: 'Codex' };

export type Tone = 'plain' | 'good' | 'bad' | 'quiet';
export type FeedLine = { at: string; run: string; text: string; tone: Tone };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const money = (usd: unknown) => (typeof usd === 'number' ? `$${usd.toFixed(2)}` : 'not priced');
const took = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

const handedTo = (to: unknown) => {
  const adapter = str((to as { adapter?: unknown } | null)?.adapter);
  return adapter ? ` for ${AGENTS[adapter] ?? adapter}` : '';
};

/** Who a run is: a coding agent by its harness, a plan or review call by the model that answered and where it ran. */
function who(started: StintEvent, finished?: StintEvent): string {
  const adapter = started.adapter ?? '';
  if (adapter !== 'openai-compatible') {
    // the Stint agent learns its model as it starts, so it is named once the run has ended
    const late = !started.payload.model && finished?.payload.model ? ` on ${modelName(str(finished.payload.model))}` : '';
    return `${AGENTS[adapter] ?? adapter}${late}`;
  }
  const p = finished?.payload ?? started.payload;
  return `${modelName(str(p.model))}${p.host === 'ollama' ? ' on this machine' : ''}`;
}

/**
 * The live feed of one task, a line per event that says what happened: runs starting and ending, edits, packets,
 * Stint's test runs, reviews, approval and the merge. Chatter (tool results, costs, status flips) is left out.
 */
export function feed(): (e: StintEvent) => FeedLine | null {
  const started = new Map<string, StintEvent>();
  return (e) => {
    const p = e.payload;
    const line = (text: string, tone: Tone = 'plain'): FeedLine => ({ at: new Date(e.ts).toTimeString().slice(0, 8), run: e.run ?? '', text, tone });
    switch (e.type) {
      case 'task.created':
        return line(`Task created: ${str(p.title)}`);
      case 'run.started': {
        if (e.run) started.set(e.run, e);
        if (e.adapter === 'openai-compatible') return line(`${who(e)} ${p.role === 'planner' ? 'plans it' : p.role === 'reviewer' ? 'reviews it' : `answers (${str(p.role)})`}`);
        return line(`${who(e)}${p.model ? ` on ${modelName(str(p.model))}` : ''} started${p.handoffFrom ? ` from packet ${str(p.handoffFrom)}, never the transcript` : ''}`);
      }
      case 'agent.message':
        return line(`"${clip(str(p.text))}"`, 'quiet');
      case 'agent.tool_call': {
        const args = (p.args ?? {}) as Record<string, unknown>;
        const target = str(args.path) || str(args.file_path) || str(args.command) || str(args.pattern);
        return target ? line(`${str(p.tool)} ${clip(target, 80)}`, 'quiet') : null;
      }
      case 'file.changed':
        return line(`${str(p.path)} +${Number(p.added)} -${Number(p.removed)}`);
      case 'decision.recorded':
        return line(`${str(p.id)} decided: ${clip(str(p.text))}`);
      case 'handoff.created':
        return line(`Packet ${str(p.name)}${handedTo(p.to)}: ${Number(p.tokens)} tokens${p.reason === 'killed' ? ', built from the log and the diff' : ''}`);
      case 'verification.ran':
        return p.status === 'green'
          ? line(`✓ Tests run by Stint: ${Number(p.passed)} passed${p.tamper === null ? ', tests unchanged' : ''}, ${Number(p.failed)} failed`, 'good')
          : line(`✗ Tests run by Stint: ${Number(p.passed)} passed, ${Number(p.failed)} failed`, 'bad');
      case 'review.recorded':
        return line(`Review: ${str(p.verdict).replace('_', ' ')}, ${Number(p.findings)} finding${Number(p.findings) === 1 ? '' : 's'}${p.offline ? ', offline' : ''}`, p.verdict === 'approve' ? 'good' : 'bad');
      case 'run.finished': {
        const s = e.run ? started.get(e.run) : undefined;
        if (!s) return null;
        const after = took(Date.parse(e.ts) - Date.parse(s.ts));
        const cost = money((p.cost as { usd?: unknown } | undefined)?.usd);
        if (p.endedBy === 'killed') return line(`✗ ${who(s, e)} killed after ${after}${p.inFlight ? `, in the middle of ${str(p.inFlight)}` : ''}`, 'bad');
        if (p.endedBy === 'failed') return line(`✗ ${who(s, e)} failed after ${after}: ${clip(str(p.reason))}`, 'bad');
        return line(`${who(s, e)} finished in ${after}, ${cost}`);
      }
      case 'approval.requested':
        return line('Waiting for your approval');
      case 'approval.granted':
        return line(`Approved by ${str(p.by) || 'a person'}`);
      case 'approval.rejected':
        return line(`✗ Rejected: ${clip(str(p.reason))}`, 'bad');
      case 'merge.completed':
        return line(`✓ Merged into ${str(p.into) || 'the base branch'} as ${str(p.commit).slice(0, 7)}`, 'good');
      case 'provider.fallback':
        return line(`${str(p.from)} did not answer (${str(p.reason)}), so ${str(p.to)} did`, 'quiet');
      case 'run.refused':
        return line(`✗ Run refused: ${clip(str(p.message))}`, 'bad');
      case 'rule.blocked':
        return line(`✗ Refused by Stint rules: ${clip(str(p.action), 80)}`, 'bad');
      case 'limit.reached':
        return line(`The ${str(p.limit)} limit is reached`, 'bad');
      default:
        return null;
    }
  };
}

const INK: Record<Tone, string> = { plain: '', good: '\x1b[32m', bad: '\x1b[31m', quiet: '\x1b[2m' };

/** The line as printed: time, the task when following them all, run and text, coloured only on a terminal that wants colour. */
export function render(l: FeedLine, colour: boolean, task?: string): string {
  if (!colour) return `${l.at}  ${task ? `${task}  ` : ''}${l.run.padEnd(3)}  ${l.text}`;
  return `\x1b[2m${l.at}\x1b[0m  ${task ? `\x1b[1m${task}\x1b[0m  ` : ''}\x1b[36m${l.run.padEnd(3)}\x1b[0m  ${INK[l.tone]}${l.text}\x1b[0m`;
}

export const watchCommand = defineCommand({
  meta: { name: 'watch', description: "Follow a task, or every task, as it happens: runs, edits, packets, Stint's test runs, the review and the merge" },
  args: {
    task: { type: 'positional', required: false, description: 'Task id (default: every task, each line marked with its task)' },
    all: { type: 'boolean', description: 'Print what already happened first' },
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const colour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
    if (!args.task) return watchAll(root, colour);
    const next = feed();
    const print = (e: StintEvent) => {
      const l = next(e);
      if (l) process.stdout.write(`${render(l, colour)}\n`);
    };
    // what already happened names the runs that end later, so it goes through the feed even when it is not printed
    const { events } = await getDaemon<{ events: StintEvent[] }>(root, `/api/tasks/${args.task}/events`);
    for (const e of events) {
      if (args.all) print(e);
      else next(e);
    }
    const since = events.at(-1)?.seq ?? 0;
    const stop = new AbortController();
    process.on('SIGINT', () => stop.abort());
    for await (const m of readSSE(`${daemonFor(root).url}/api/tasks/${args.task}/stream?since=${since}`, stop.signal)) {
      if (m.event !== 'heartbeat') print(JSON.parse(m.data) as StintEvent);
    }
  },
});

/** Every task of the workspace on one feed, as tasks are made, built, reviewed and merged in parallel. */
async function watchAll(root: string, colour: boolean) {
  const feeds = new Map<string, ReturnType<typeof feed>>();
  const feedOf = (task: string) => {
    if (!feeds.has(task)) feeds.set(task, feed());
    return feeds.get(task) as ReturnType<typeof feed>;
  };
  // runs that started before the watch end on it later, so each task's log goes through its feed first, unprinted
  const { tasks } = await getDaemon<{ tasks: Array<{ task: { id: string } }> }>(root, '/api/tasks');
  for (const { task } of tasks) for (const e of (await getDaemon<{ events: StintEvent[] }>(root, `/api/tasks/${task.id}/events`)).events) feedOf(task.id)(e);
  process.stdout.write(colour ? '\x1b[2mFollowing every task. Ctrl-C stops.\x1b[0m\n' : 'Following every task. Ctrl-C stops.\n');
  const stop = new AbortController();
  process.on('SIGINT', () => stop.abort());
  // shortcut: the workspace stream has no since, so an event between the log reads and the stream's start is not printed; add since to /api/stream if that shows
  for await (const m of readSSE(`${daemonFor(root).url}/api/stream`, stop.signal)) {
    if (m.event === 'heartbeat') continue;
    const e = JSON.parse(m.data) as StintEvent;
    if (!/^T-\d+$/.test(e.task)) continue;
    const l = feedOf(e.task)(e);
    if (l) process.stdout.write(`${render(l, colour, e.task)}\n`);
  }
}
