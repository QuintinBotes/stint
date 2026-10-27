import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Workspace, metricsOtlpBody, otlpBody, taskSpans } from '@stint-dev/core/node';
import { defineCommand } from 'citty';
import { workspaceMetrics } from './metrics';
import { repoRoot } from './repo';

/** Writes one task's trace as OTLP JSON, for a collector or eval tool to import offline (R-043). */
export async function otelExport(root: string, task: string, out?: string): Promise<{ path: string; spans: number }> {
  const ws = await Workspace.open(root);
  const t = await ws.readTask(task);
  const spans = taskSpans(t, await ws.events(task).read(), { withTask: true });
  // beside the person, like stint export's zip: only the daemon writes under .stint/
  const path = resolve(out ?? `${task}.otel.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(otlpBody(spans, ws.config.otel?.serviceName ?? 'stint', '0.1.0'), null, 2)}\n`);
  return { path, spans: spans.length };
}

/** Writes the workspace metrics as OTLP gauge points, one per metric with the attribute stint.metric.id (R-061). */
export async function otelMetricsExport(root: string, out?: string): Promise<{ path: string; points: number }> {
  const ws = await Workspace.open(root);
  const m = await workspaceMetrics(root, { window: '30d' });
  const values = Object.values(m.groups).flat();
  const path = resolve(out ?? 'metrics.otel.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(metricsOtlpBody(values, ws.config.otel?.serviceName ?? 'stint', '0.1.0', m.generatedAt), null, 2)}\n`);
  return { path, points: values.filter((v) => v.value !== null).length };
}

const exportCommand = defineCommand({
  meta: { name: 'export', description: "Write a task's runs and tool calls as OpenTelemetry spans (OTLP JSON)" },
  args: {
    task: { type: 'positional', description: 'Task id, such as T-0042 (not needed with --metrics)', required: false },
    metrics: { type: 'boolean', description: 'Write the workspace metrics as gauge points instead of spans' },
    out: { type: 'string', description: 'Where to write it (default ./<task>.otel.json, or ./metrics.otel.json with --metrics)' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    if (!existsSync(join(root, '.stint'))) {
      process.stderr.write(`No .stint/ in ${root}. Run stint up or stint demo first.\n`);
      process.exit(1);
    }
    if (args.metrics) {
      const r = await otelMetricsExport(root, args.out);
      process.stdout.write(`${r.points} gauge points written to ${r.path}\n`);
      return;
    }
    if (!args.task) {
      process.stderr.write('A task id is required unless --metrics is given.\n');
      process.exit(2);
    }
    const r = await otelExport(root, String(args.task), args.out);
    process.stdout.write(`${r.spans} spans written to ${r.path}\n`);
  },
});

export const otel = defineCommand({
  meta: { name: 'otel', description: 'OpenTelemetry export of runs, model calls and tool calls' },
  subCommands: { export: exportCommand },
});
