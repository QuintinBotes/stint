import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineCommand } from 'citty';

/** The repository a worktree belongs to: `<repo>/.stint/worktrees/<task>-<run>`. */
function repoOfWorktree(worktree: string): string {
  return resolve(worktree, '..', '..', '..');
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  const done = new Promise<void>((r) => {
    process.stdin.on('data', (b: Buffer) => chunks.push(b));
    process.stdin.on('end', () => r());
    process.stdin.on('error', () => r());
  });
  await Promise.race([done, Bun.sleep(1000)]);
  return Buffer.concat(chunks).toString('utf8');
}

/** The tool and its input from a hook payload, whatever the field names. */
export function toolFromPayload(text: string): { tool: string; args: Record<string, unknown> } | null {
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    const tool = [p.tool_name, p.toolName, p.tool, p.name].find((v) => typeof v === 'string') as string | undefined;
    const input = [p.tool_input, p.toolInput, p.input, p.arguments, p.args].find((v) => v && typeof v === 'object') as Record<string, unknown> | undefined;
    return tool ? { tool, args: input ?? {} } : null;
  } catch {
    return null;
  }
}

export const hook = defineCommand({
  meta: { name: 'hook', description: 'Called by the agent\'s hooks inside a Stint run; never blocks the agent' },
  args: { event: { type: 'positional', required: true, description: 'PreCompact, SubagentStop or PreToolUse' } },
  async run({ args }) {
    const task = process.env.STINT_TASK;
    const run = process.env.STINT_RUN;
    const worktree = process.env.STINT_WORKTREE;
    if (!task || !run || !worktree) process.exit(0);
    const info = join(repoOfWorktree(worktree), '.stint', 'cache', 'daemon.json');
    let addr = info;
    try {
      if (!existsSync(info)) throw new Error('no daemon.json');
      const d = JSON.parse(readFileSync(info, 'utf8')) as { port: number; token: string };
      addr = `127.0.0.1:${d.port}`;
      const headers = { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' };
      const base = `http://${addr}/api/tasks/${task}`;
      const signal = AbortSignal.timeout(4000);
      let res: Response;
      if (args.event === 'PreToolUse') {
        const t = toolFromPayload(await readStdin());
        if (!t) process.exit(0);
        res = await fetch(`${base}/runs/${run}/inflight`, { method: 'POST', headers, body: JSON.stringify(t), signal });
      } else {
        res = await fetch(`${base}/handoff`, { method: 'POST', headers, body: JSON.stringify({ run, reason: args.event.toLowerCase() }), signal });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      process.stderr.write(`Stint hook: could not reach the daemon at ${addr}. The packet was NOT drafted.\n`);
    }
    process.exit(0);
  },
});
