import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type CostGroup, Workspace, costs as costRows } from '@stint-dev/core/node';
import { defineCommand } from 'citty';
import { repoRoot } from './repo';

const usd = (v: number | null) => (v === null ? 'unpriced' : v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

export const costs = defineCommand({
  meta: { name: 'costs', description: 'Tokens and money per task, run, day, week or host, as the daemon metered them' },
  args: {
    by: { type: 'string', description: 'task, run, day, week (Monday to Sunday, local time) or host', default: 'task' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    json: { type: 'boolean', description: 'Machine-readable output' },
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    if (!existsSync(join(root, '.stint'))) {
      process.stderr.write(`No .stint/ in ${root}. Run stint up or stint demo first.\n`);
      process.exit(1);
    }
    const by = args.by as CostGroup;
    if (!['task', 'run', 'day', 'week', 'host'].includes(by)) {
      process.stderr.write(`--by must be task, run, day, week or host, not ${by}\n`);
      process.exit(2);
    }
    const rows = await costRows(await Workspace.open(root), { group: by });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(rows)}\n`);
      return;
    }
    for (const r of rows) {
      const share = r.inputTokens ? Math.round((r.cachedTokens / r.inputTokens) * 100) : 0;
      process.stdout.write(`${r.key.padEnd(16)} ${String(r.inputTokens).padStart(9)} in (${share}% cached) ${String(r.outputTokens).padStart(7)} out  ${(r.estimated ? '≈' : '') + usd(r.usd)}${r.unpriced ? `, ${r.unpriced} run${r.unpriced === 1 ? '' : 's'} unpriced` : ''}\n`);
    }
  },
});
