import { countTokens, renderHandoff } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { defineCommand } from 'citty';
import { postDaemon } from './client';
import { repoRoot } from './repo';

export const packet = defineCommand({
  meta: { name: 'packet', description: 'Print a task\'s packet and its token count' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id, e.g. T-0042' },
    run: { type: 'string', description: 'The packet built from this run (default: the latest packet)' },
    as: { type: 'string', description: 'prompt or json', default: 'prompt' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
  },
  async run({ args }) {
    const ws = await Workspace.open(repoRoot(args.repo));
    const store = ws.handoffs(args.task);
    let h = await store.latest();
    if (args.run) {
      h = null;
      for (const name of await store.names()) {
        const p = await store.read(name);
        if (p?.from.run === args.run) h = p;
      }
    }
    if (!h) {
      process.stderr.write(`${args.task} has no packet${args.run ? ` from ${args.run}` : ''} yet. Every run that ends builds one.\n`);
      process.exit(1);
    }
    const text = renderHandoff(h);
    if (args.as === 'json') process.stdout.write(`${JSON.stringify(h, null, 2)}\n`);
    else process.stdout.write(text);
    process.stderr.write(`${countTokens(text)} tokens, ${new TextEncoder().encode(text).length} bytes, ${h.hash}\n`);
  },
});

export const hand = defineCommand({
  meta: { name: 'hand', description: 'Hand a task to another agent: a packet addressed to it, then a run from that packet' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id' },
    adapter: { type: 'positional', required: true, description: 'The next agent, e.g. stint-agent or muse-code' },
    role: { type: 'string', description: 'implementer (default) or reviewer' },
    ask: { type: 'string', description: 'An extra instruction for the next agent' },
    model: { type: 'string', description: 'Model for the next run' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    json: { type: 'boolean', description: 'Machine-readable output' },
  },
  async run({ args }) {
    const r = await postDaemon<{ packet: string; tokens: number; run: string; worktree: string }>(repoRoot(args.repo), `/api/tasks/${args.task}/hand`, {
      adapter: args.adapter,
      ...(args.role ? { role: args.role } : {}),
      ...(args.ask ? { ask: args.ask } : {}),
      ...(args.model ? { model: args.model } : {}),
    });
    if (args.json) process.stdout.write(`${JSON.stringify(r)}\n`);
    else process.stdout.write(`Packet ${r.packet} (${r.tokens} tokens) handed to ${args.adapter}: run ${r.run} in ${r.worktree}\n`);
  },
});
