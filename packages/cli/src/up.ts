import { defineCommand } from 'citty';
import { startDaemon } from '@stint-dev/daemon';
import { repoRoot } from './repo';

export const up = defineCommand({
  meta: { name: 'up', description: 'Start the daemon on 127.0.0.1 for this repository' },
  args: {
    port: { type: 'string', description: 'Port (0 picks a free one)', default: '0' },
    open: { type: 'boolean', description: 'Copy the URL to the clipboard' },
    check: { type: 'boolean', description: 'Start, print health, stop' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    json: { type: 'boolean', description: 'Machine-readable output' },
  },
  async run({ args }) {
    const d = await startDaemon({ root: repoRoot(args.repo), port: Number(args.port) || 0, quiet: Boolean(args.check), handleSignals: !args.check });
    if (args.check) {
      const health = (await (await fetch(`${d.url}/api/health`)).json()) as { ok: boolean; adapters: Array<{ id: string; capability: { level: string; reason?: string } }> };
      await d.stop();
      if (args.json) {
        process.stdout.write(`${JSON.stringify(health)}\n`);
      } else {
        process.stdout.write(`daemon ok at ${d.url} (stopped after the check)\n`);
        for (const a of health.adapters) {
          const state = a.capability.level === 'supported' ? 'available' : `unavailable: ${a.capability.reason ?? a.capability.level}`;
          process.stdout.write(`  ${a.id.padEnd(18)} ${state}\n`);
        }
      }
      process.exit(health.ok ? 0 : 1);
    }
    process.stdout.write(`Stint is running at ${d.url}\n`);
    if (args.open) {
      const copy = process.platform === 'darwin' ? ['pbcopy'] : Bun.which('xclip') ? ['xclip', '-selection', 'clipboard'] : null;
      if (copy) {
        const p = Bun.spawn(copy, { stdin: 'pipe' });
        p.stdin.write(d.url);
        p.stdin.end();
        await p.exited;
        process.stdout.write('The URL is on the clipboard.\n');
      }
    }
  },
});
