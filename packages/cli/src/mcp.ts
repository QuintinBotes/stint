import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { type Handoff, renderHandoff } from '@stint-dev/core';
import { defineCommand } from 'citty';
import { daemonFromEnv } from './hook';
import { repoRoot } from './repo';

/**
 * Stint as an MCP server over stdio, for any agent that speaks MCP: Muse Code through the Stint plugin, or any
 * other client. Every tool goes through the running daemon, which stays the only writer of `.stint/`. Approving,
 * rejecting and merging are not tools: a person does those.
 */

type Json = Record<string, unknown>;
type Tool = { name: string; description: string; inputSchema: Json; call: (args: Json) => Promise<string> };

const PROTOCOL = '2025-06-18';

class ToolError extends Error {}

function daemon(root: string): { url: string; token: string } {
  const run = daemonFromEnv();
  if (run) return { url: `http://127.0.0.1:${run.port}`, token: run.token };
  const info = join(root, '.stint', 'cache', 'daemon.json');
  if (!existsSync(info)) throw new ToolError(`No Stint daemon is running for ${root}. Start one with: stint up`);
  const d = JSON.parse(readFileSync(info, 'utf8')) as { port: number; token: string };
  return { url: `http://127.0.0.1:${d.port}`, token: d.token };
}

async function call<T>(root: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const d = daemon(root);
  let res: Response;
  try {
    res = await fetch(`${d.url}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${d.token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new ToolError(`The Stint daemon for ${root} is not answering. Start one with: stint up`);
  }
  const text = await res.text();
  if (!res.ok) {
    const e = (() => {
      try {
        return (JSON.parse(text) as { error?: { code: string; message: string; hint: unknown } }).error;
      } catch {
        return undefined;
      }
    })();
    throw new ToolError(`${e?.code ?? res.status}: ${e?.message ?? text.slice(0, 300)}${e?.hint ? ` (${typeof e.hint === 'string' ? e.hint : JSON.stringify(e.hint)})` : ''}`);
  }
  return (res.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text) as T;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The task a tool acts on: the one named, else the one this agent is running on inside Stint. */
function taskOf(args: Json): string {
  const id = str(args.task) ?? process.env.STINT_TASK;
  if (!id) throw new ToolError('Name the task, for example "T-0042". Inside a Stint run it defaults to the run\'s task.');
  if (!/^T-\d{4,}$/.test(id)) throw new ToolError(`${id} is not a task id; ids look like T-0042`);
  return id;
}

const prop = (type: string, description: string, extra: Json = {}) => ({ type, description, ...extra });
const taskProp = prop('string', 'Task id such as T-0042; inside a Stint run, defaults to the run\'s task');

/** Tools a run's own token is refused on: a new task is outside its task, and hand and verify wait for its run to end. */
const OUTSIDE_A_RUN = new Set(['stint_new_task', 'stint_hand', 'stint_verify', 'stint_stop', 'stint_new_goal', 'stint_plan_goal', 'stint_run_goal']);

/** Stint's tools; inside a run (STINT_RUN_TOKEN set) only the ones its token can call, so none of them always fails. */
export function tools(root: string): Tool[] {
  const all: Tool[] = [
    {
      name: 'stint_status',
      description: 'The board: every task with its status, who holds it, its cost and its autopilot step.',
      inputSchema: { type: 'object', properties: {} },
      call: async () => {
        const { tasks } = await call<{ tasks: Array<{ task: { id: string; title: string; status: string }; cost: { usd: number | null }; lastRun: { adapter: string | null; run: string } | null; autopilot?: { on: boolean; step: string | null; reason: string | null } | null }> }>(root, '/api/tasks');
        if (tasks.length === 0) return 'No tasks yet. Create one with stint_new_task.';
        return tasks
          .map((c) => `${c.task.id} [${c.task.status}] ${c.task.title}${c.lastRun ? `; last run ${c.lastRun.run} by ${c.lastRun.adapter}` : ''}${c.cost.usd !== null ? `; $${c.cost.usd.toFixed(2)}` : ''}${c.autopilot?.on ? `; autopilot: ${c.autopilot.reason ?? c.autopilot.step}` : ''}`)
          .join('\n');
      },
    },
    {
      name: 'stint_task',
      description: 'One task in full: goal, acceptance criteria, runs, the daemon\'s verification, the review, and the decisions in force.',
      inputSchema: { type: 'object', properties: { task: taskProp } },
      call: async (args) => {
        const id = taskOf(args);
        const b = await call<{ task: { title: string; goal: string; acceptance: string[]; status: string; branch: string }; runs: Array<{ run: string; adapter: string | null; model: string | null; role: string | null; endedBy: string | null }>; verification: { status: string; passed: number; failed: number; command: string } | null; review: { verdict: string; findings: Array<{ id: string; text: string }> } | null }>(root, `/api/tasks/${id}`);
        const decisions = await call<Array<{ id: string; text: string }>>(root, `/api/tasks/${id}/decisions`);
        return [
          `${id}: ${b.task.title} [${b.task.status}], branch ${b.task.branch}`,
          `Goal: ${b.task.goal}`,
          'Acceptance:',
          ...b.task.acceptance.map((a) => `- ${a}`),
          'Runs:',
          ...(b.runs.length ? b.runs.map((r) => `- ${r.run} ${r.adapter} (${r.model ?? 'model unknown'}), ${r.role}, ${r.endedBy ?? 'running'}`) : ['- none yet']),
          `Verification by the daemon: ${b.verification ? `${b.verification.status}, ${b.verification.passed} passed, ${b.verification.failed} failed (${b.verification.command})` : 'not run yet'}`,
          `Review: ${b.review ? `${b.review.verdict}${b.review.findings.map((f) => `; ${f.id} ${f.text}`).join('')}` : 'none yet'}`,
          'Decisions in force:',
          ...(decisions.length ? decisions.map((d) => `- ${d.id}: ${d.text}`) : ['- none']),
        ].join('\n');
      },
    },
    {
      name: 'stint_new_task',
      description: 'Create a task. It appears on the board as planned; the daemon, an agent or a person runs it.',
      inputSchema: {
        type: 'object',
        properties: {
          title: prop('string', 'What the task is, in a few words'),
          goal: prop('string', 'What done looks like (defaults to the title)'),
          acceptance: prop('array', 'Acceptance criteria, one per item', { items: { type: 'string' } }),
          testCommand: prop('string', 'The command the daemon runs to verify (defaults to the workspace setting)'),
        },
        required: ['title'],
      },
      call: async (args) => {
        const title = str(args.title);
        if (!title) throw new ToolError('A task needs a title');
        const acceptance = Array.isArray(args.acceptance) ? (args.acceptance as unknown[]).map(String).filter(Boolean) : [];
        const t = await call<{ id: string; branch: string }>(root, '/api/tasks', {
          method: 'POST',
          body: { title, goal: str(args.goal) ?? title, acceptance: acceptance.length ? acceptance : [str(args.goal) ?? title], ...(str(args.testCommand) ? { testCommand: str(args.testCommand) } : {}) },
        });
        return `Created ${t.id} on branch ${t.branch}. Run it with stint_autopilot, or open it in the Stint UI.`;
      },
    },
    {
      name: 'stint_packet',
      description: 'A task\'s handoff packet as the next agent reads it: where the work got to, what is done and open, what was refused, the decisions, and the ask of the next agent.',
      inputSchema: { type: 'object', properties: { task: taskProp, name: prop('string', 'Packet name such as h2 (defaults to the latest)') } },
      call: async (args) => {
        const id = taskOf(args);
        const { names } = await call<{ names: string[] }>(root, `/api/tasks/${id}/handoffs`);
        const name = str(args.name) ?? names.at(-1);
        if (!name) throw new ToolError(`${id} has no packet yet. Every run that ends builds one.`);
        const { packet } = await call<{ packet: Handoff }>(root, `/api/tasks/${id}/handoffs/${name}`);
        return renderHandoff(packet);
      },
    },
    {
      name: 'stint_similar',
      description: 'Earlier tasks like this one, from Stint\'s memory graph, each with the evidence: shared files, the same review findings, shared tags.',
      inputSchema: { type: 'object', properties: { task: taskProp } },
      call: async (args) => {
        const rows = await call<Array<{ task: string; score: number; evidence: { files: string[]; themes: string[]; tags: string[] } }>>(root, `/api/graph/query?q=similar&task=${taskOf(args)}`);
        if (rows.length === 0) return 'No earlier task shares files, findings or tags with this one.';
        return rows.map((r) => `${r.task} (score ${r.score}): files ${r.evidence.files.join(', ') || 'none'}; findings on ${r.evidence.themes.join(', ') || 'none'}; tags ${r.evidence.tags.join(', ') || 'none'}`).join('\n');
      },
    },
    {
      name: 'stint_constraints',
      description: 'What constrains a task: the decisions in force and the open review findings on the files it touches, across every task.',
      inputSchema: { type: 'object', properties: { task: taskProp } },
      call: async (args) => {
        const rows = await call<Array<{ kind: string; id: string; task: string; text: string; files: string[] }>>(root, `/api/graph/query?q=constrains&task=${taskOf(args)}`);
        if (rows.length === 0) return 'No decision or open finding applies to these files.';
        return rows.map((r) => `${r.kind} ${r.id} (${r.task}): ${r.text} [${r.files.slice(0, 4).join(', ')}]`).join('\n');
      },
    },
    {
      name: 'stint_files_together',
      description: 'Files that have changed alongside this one in earlier runs, most often first.',
      inputSchema: { type: 'object', properties: { path: prop('string', 'A path in the repository, such as src/app.ts') }, required: ['path'] },
      call: async (args) => {
        const path = str(args.path);
        if (!path) throw new ToolError('Name a path');
        const rows = await call<Array<{ path: string; count: number }>>(root, `/api/graph/query?q=files-together&path=${encodeURIComponent(path)}`);
        return rows.length ? rows.map((r) => `${r.path}: ${r.count} time${r.count === 1 ? '' : 's'}`).join('\n') : `${path} has not changed alongside other files yet.`;
      },
    },
    {
      name: 'stint_decide',
      description: 'Record a decision on a task so later agents and reviewers do not silently reverse it. A reversal names the decision it supersedes.',
      inputSchema: { type: 'object', properties: { task: taskProp, text: prop('string', 'The decision, in one sentence'), supersedes: prop('string', 'The decision it replaces, such as D3') }, required: ['text'] },
      call: async (args) => {
        const id = taskOf(args);
        const text = str(args.text);
        if (!text) throw new ToolError('A decision needs its text');
        const by = process.env.STINT_RUN ? `agent ${process.env.STINT_RUN}` : 'an MCP client';
        const d = await call<{ id: string }>(root, `/api/tasks/${id}/decisions`, { method: 'POST', body: { text, by, ...(str(args.supersedes) ? { supersedes: str(args.supersedes) } : {}) } });
        return `Recorded ${d.id} on ${id}: ${text}`;
      },
    },
    {
      name: 'stint_hand',
      description: 'Hand a task to another agent: the daemon writes a packet addressed to it and starts its run from that packet.',
      inputSchema: { type: 'object', properties: { task: taskProp, agent: prop('string', 'The agent to hand to, such as stint-agent or muse-code'), ask: prop('string', 'Anything to add to the packet\'s ask') }, required: ['agent'] },
      call: async (args) => {
        const id = taskOf(args);
        const agent = str(args.agent);
        if (!agent) throw new ToolError('Name the agent to hand to');
        const r = await call<{ run: string; packet: string; tokens: number }>(root, `/api/tasks/${id}/hand`, { method: 'POST', body: { adapter: agent, ...(str(args.ask) ? { ask: str(args.ask) } : {}) } });
        return `${agent} started ${id} ${r.run} from packet ${r.packet} (${r.tokens} tokens).`;
      },
    },
    {
      name: 'stint_autopilot',
      description: 'Put a task on autopilot (plan, build, verify, review, handing off when a run fails; it stops at the person\'s approval), or take it off.',
      inputSchema: { type: 'object', properties: { task: taskProp, on: prop('boolean', 'true to start, false to stop') }, required: ['on'] },
      call: async (args) => {
        const id = taskOf(args);
        const on = args.on !== false;
        await call(root, `/api/tasks/${id}/autopilot`, { method: 'POST', body: { on } });
        return on ? `${id} is on autopilot; it stops at your approval.` : `${id} is off autopilot; a live run keeps going.`;
      },
    },
    {
      name: 'stint_verify',
      description: 'Have the daemon run the task\'s tests itself and report the result. The result is the record, not an agent\'s claim.',
      inputSchema: { type: 'object', properties: { task: taskProp } },
      call: async (args) => {
        const id = taskOf(args);
        const v = await call<{ status: string; passed: number; failed: number; command: string; failing?: string[] }>(root, `/api/tasks/${id}/verify`, { method: 'POST', body: {} });
        return `${v.command}: ${v.status}, ${v.passed} passed, ${v.failed} failed${v.failing?.length ? `. Failing: ${v.failing.join('; ')}` : ''}`;
      },
    },
    {
      name: 'stint_stop',
      description: "Stop a task's live run, as Stop the run does in the UI; Stint builds its packet from the log and the diff, so another agent can continue.",
      inputSchema: { type: 'object', properties: { task: taskProp, run: prop('string', 'The run to stop, such as r2; defaults to the one that is going') } },
      call: async (args) => {
        const id = taskOf(args);
        const run = str(args.run) ?? (await call<{ runs: Array<{ run: string; endedAt: string | null }> }>(root, `/api/tasks/${id}`)).runs.find((r) => !r.endedAt)?.run;
        if (!run) throw new ToolError(`${id} has no run going`);
        await call(root, `/api/tasks/${id}/runs/${run}/stop`, { method: 'POST', body: {} });
        return `Stopped ${id} ${run}. Its packet is built from the log and the diff; hand it on with stint_hand.`;
      },
    },
    {
      name: 'stint_new_goal',
      description: 'Make a goal: an outcome bigger than one task, and the criteria that prove it. stint_plan_goal splits it into tasks.',
      inputSchema: {
        type: 'object',
        properties: { title: prop('string', 'The goal in a few words'), outcome: prop('string', 'What is true once it is done'), criteria: prop('array', 'One check per line that proves the goal is met', { items: { type: 'string' } }) },
        required: ['title', 'outcome', 'criteria'],
      },
      call: async (args) => {
        const title = str(args.title);
        const outcome = str(args.outcome);
        const criteria = Array.isArray(args.criteria) ? args.criteria.map(str).filter((c): c is string => !!c) : [];
        if (!title || !outcome || !criteria.length) throw new ToolError('Give the goal a title, an outcome and at least one criterion');
        const g = await call<{ id: string }>(root, '/api/goals', { method: 'POST', body: { title, outcome, criteria } });
        return `Made ${g.id}, ${title}, with ${criteria.length} criteria. Split it into tasks with stint_plan_goal.`;
      },
    },
    {
      name: 'stint_plan_goal',
      description: "Have Stint's planner split a goal into tasks, each with what it waits on, and create them on the board.",
      inputSchema: { type: 'object', properties: { goal: prop('string', 'Goal id such as G-0001') }, required: ['goal'] },
      call: async (args) => {
        const goal = str(args.goal);
        if (!goal) throw new ToolError('Name the goal, such as G-0001');
        const { tasks } = await call<{ tasks: unknown[] }>(root, `/api/goals/${goal}/plan`, { method: 'POST', body: {} });
        const made = await call<{ tasks: Array<{ id: string; title: string; dependsOn?: string[] }> }>(root, `/api/goals/${goal}/tasks`, { method: 'POST', body: { tasks } });
        const lines = made.tasks.map((t) => `- ${t.id} ${t.title}${t.dependsOn?.length ? `, after ${t.dependsOn.join(' and ')}` : ''}`);
        return `${goal} is split into ${made.tasks.length} tasks:\n${lines.join('\n')}\nRun them with stint_run_goal.`;
      },
    },
    {
      name: 'stint_run_goal',
      description: "Put every open task of a goal on autopilot; a task waits for the tasks it depends on to be merged, and each stops at the person's approval.",
      inputSchema: { type: 'object', properties: { goal: prop('string', 'Goal id such as G-0001') }, required: ['goal'] },
      call: async (args) => {
        const goal = str(args.goal);
        if (!goal) throw new ToolError('Name the goal, such as G-0001');
        const r = await call<{ started: string[] }>(root, `/api/goals/${goal}/run`, { method: 'POST', body: {} });
        return r.started.length ? `${goal}: ${r.started.join(', ')} on autopilot; tasks that wait on others start once those are merged, and nothing merges without the person.` : `${goal}: no open task to start.`;
      },
    },
  ];
  return process.env.STINT_RUN_TOKEN ? all.filter((t) => !OUTSIDE_A_RUN.has(t.name)) : all;
}

/** One JSON-RPC exchange: the reply to a request, or nothing for a notification. */
export async function handle(msg: Json, list: Tool[]): Promise<Json | null> {
  const id = msg.id;
  if (id === undefined || id === null) return null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  const params = (msg.params ?? {}) as Json;
  switch (msg.method) {
    case 'initialize':
      return ok({
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'stint', version: '0.1.0' },
        instructions: 'Stint keeps the task alive across agents. Read the packet before continuing a task, check constraints before changing a file, record decisions with stint_decide, and leave approving to the person.',
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: list.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = list.find((t) => t.name === params.name);
      if (!tool) return ok({ content: [{ type: 'text', text: `No tool named ${String(params.name)}. Stint's tools: ${list.map((t) => t.name).join(', ')}` }], isError: true });
      try {
        return ok({ content: [{ type: 'text', text: await tool.call((params.arguments ?? {}) as Json) }] });
      } catch (err) {
        return ok({ content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${String(msg.method)}`);
  }
}

/** The repository: the one named, the one a Stint run's worktree belongs to, or the git top level. */
function rootFor(repo: string | undefined): string {
  if (repo) return repoRoot(repo);
  if (process.env.STINT_WORKTREE) return resolve(process.env.STINT_WORKTREE, '..', '..', '..');
  return repoRoot(undefined);
}

/** The tools `stint mcp install` registers with, each through its own CLI, and what that changes. */
const CLIENTS = {
  claude: { name: 'Claude Code', changed: (root: string) => `Claude Code starts Stint's MCP server for ${root} when you open it in that folder (its local scope).` },
  codex: { name: 'Codex', changed: (root: string) => `Codex starts Stint's MCP server for ${root} in every session: [mcp_servers.stint] in ~/.codex/config.toml.` },
} as const;
export type McpClient = keyof typeof CLIENTS;

/** The command that registers Stint's server; `stint` itself when it is on PATH, else this checkout's bin. */
export function installCommand(client: McpClient, root: string, stint = Bun.which('stint') ? 'stint' : resolve(import.meta.dir, '..', 'bin', 'stint')): string[] {
  return [client, 'mcp', 'add', 'stint', '--', stint, 'mcp', '--repo', root];
}

const shellWord = (w: string) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replaceAll("'", "'\\''")}'`);

const install = defineCommand({
  meta: { name: 'install', description: 'Register Stint\'s MCP server with Claude Code (claude) or Codex (codex), through their own CLIs' },
  args: {
    client: { type: 'positional', description: 'claude or codex', required: true },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    print: { type: 'boolean', description: 'Print the command without running it' },
  },
  run({ args }) {
    if (!Object.hasOwn(CLIENTS, args.client)) {
      process.stderr.write(`stint mcp install takes claude or codex, not ${args.client}\n`);
      process.exit(2);
    }
    const client = args.client as McpClient;
    const root = rootFor(args.repo);
    const argv = installCommand(client, root);
    const line = argv.map(shellWord).join(' ');
    if (args.print) {
      process.stdout.write(`${line}\n`);
      return;
    }
    if (!Bun.which(client)) {
      process.stderr.write(`${CLIENTS[client].name} is not installed here (no ${client} on PATH). Install it, or run this yourself where it is:\n${line}\n`);
      process.exit(1);
    }
    const r = Bun.spawnSync(argv, { stdout: 'inherit', stderr: 'inherit' });
    if (r.exitCode !== 0) {
      process.stderr.write(`${client} refused it (exit ${r.exitCode}); nothing was changed by Stint. The command was:\n${line}\n`);
      process.exit(r.exitCode ?? 1);
    }
    process.stdout.write(`Ran: ${line}\n${CLIENTS[client].changed(root)}\n`);
  },
});

export const mcp = defineCommand({
  meta: { name: 'mcp', description: 'Serve Stint\'s tools over MCP on stdio, for any agent that speaks MCP; install registers it with Claude Code or Codex' },
  args: { repo: { type: 'string', description: 'Repository root (default: the git top level, or the running task\'s repository)' } },
  subCommands: { install },
  async run({ args }) {
    // citty runs this after a subcommand too, and `stint mcp install` must not then wait on stdin
    if (args._[0] === 'install') return;
    const list = tools(rootFor(args.repo));
    const lines = createInterface({ input: process.stdin });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let msg: Json;
      try {
        msg = JSON.parse(line) as Json;
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        continue;
      }
      const reply = await handle(msg, list);
      if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
    }
  },
});
