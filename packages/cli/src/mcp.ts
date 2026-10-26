import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { type Handoff, renderHandoff } from '@stint-dev/core';
import { defineCommand } from 'citty';
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

export function tools(root: string): Tool[] {
  return [
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
  ];
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

export const mcp = defineCommand({
  meta: { name: 'mcp', description: 'Serve Stint\'s tools over MCP on stdio, for any agent that speaks MCP' },
  args: { repo: { type: 'string', description: 'Repository root (default: the git top level, or the running task\'s repository)' } },
  async run({ args }) {
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
