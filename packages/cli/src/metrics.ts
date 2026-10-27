import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MetricValue, Metrics } from '@stint-dev/core';
import { WINDOWS, Workspace, metrics as computeMetrics, windowFor, type WindowName } from '@stint-dev/core/node';
import { loadMetricsInput } from '@stint-dev/daemon';
import { defineCommand } from 'citty';
import { repoRoot } from './repo';

/** Metrics for one workspace, read straight from .stint/ as stint costs does (R-061). */
export async function workspaceMetrics(root: string, o: { window?: WindowName; by?: 'agent' | 'model' | 'tag'; now?: string } = {}): Promise<Metrics> {
  const ws = await Workspace.open(root);
  const now = o.now ?? new Date().toISOString();
  return computeMetrics({ ...(await loadMetricsInput(ws)), now, window: windowFor(o.window ?? '30d', now), ...(o.by ? { by: o.by } : {}) });
}

export function formatMetricValue(v: MetricValue): string {
  if (v.value === null) return v.unpriced ? `unpriced (${v.unpriced})` : 'none yet';
  if (v.unit === 'ratio') return v.value.toFixed(2);
  if (v.unit === 'usd') return `$${v.value.toFixed(v.value > 0 && v.value < 0.01 ? 4 : 2)}`;
  if (v.unit === 'ms') return v.value >= 3_600_000 ? `${(v.value / 3_600_000).toFixed(1)}h` : `${Math.round(v.value)}ms`;
  return Number.isInteger(v.value) ? String(v.value) : v.value.toFixed(2);
}

/** One line per metric: the value, its sample size, and the small-sample flag where it applies. */
export function metricsLines(m: Metrics): string[] {
  const lines: string[] = [];
  for (const [group, values] of Object.entries(m.groups)) {
    lines.push(group);
    for (const v of values) {
      const target = v.target ? (v.target.met ? '  on target' : '  below target') : '';
      lines.push(`  ${v.id.padEnd(28)} ${formatMetricValue(v).padStart(10)}  n=${v.n}${v.small ? '  small sample' : ''}${target}`);
    }
  }
  for (const row of m.breakdown ?? []) {
    lines.push(`by ${m.by}: ${row.key}`);
    for (const v of row.metrics) lines.push(`  ${v.id.padEnd(28)} ${formatMetricValue(v).padStart(10)}  n=${v.n}${v.small ? '  small sample' : ''}`);
  }
  return lines;
}

/** The metrics that miss a target in config.metrics.targets. */
export function missedTargets(m: Metrics): MetricValue[] {
  return Object.values(m.groups).flat().filter((v) => v.target && !v.target.met);
}

export const metricsCommand = defineCommand({
  meta: { name: 'metrics', description: 'Verification and outcome metrics for this workspace, as docs/metrics.md defines them' },
  args: {
    window: { type: 'string', description: '7d, 30d, 90d or all', default: '30d' },
    by: { type: 'string', description: 'agent, model or tag' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    json: { type: 'boolean', description: 'Machine-readable output' },
    check: { type: 'boolean', description: 'Exit 1 and name each metric that misses its target in config.metrics.targets' },
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    if (!existsSync(join(root, '.stint'))) {
      process.stderr.write(`No .stint/ in ${root}. Run stint up or stint demo first.\n`);
      process.exit(1);
    }
    const window = args.window as WindowName;
    if (!(WINDOWS as readonly string[]).includes(window)) {
      process.stderr.write(`--window must be 7d, 30d, 90d or all, not ${window}\n`);
      process.exit(2);
    }
    const by = args.by as 'agent' | 'model' | 'tag' | undefined;
    if (by !== undefined && !['agent', 'model', 'tag'].includes(by)) {
      process.stderr.write(`--by must be agent, model or tag, not ${by}\n`);
      process.exit(2);
    }
    const m = await workspaceMetrics(root, { window, by });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(m)}\n`);
    } else {
      process.stdout.write(`${metricsLines(m).join('\n')}\n`);
    }
    if (args.check) {
      const missed = missedTargets(m);
      if (missed.length > 0) {
        for (const v of missed) process.stderr.write(`${v.id} misses its target: ${formatMetricValue(v)} (n=${v.n})\n`);
        process.exit(1);
      }
    }
  },
});
