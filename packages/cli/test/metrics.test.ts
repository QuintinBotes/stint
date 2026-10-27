import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, MetricsSchema } from '@stint-dev/core';
import { tempDir } from '../../core/test/fixture';
import { metricsLines, missedTargets, workspaceMetrics } from '../src/metrics';
import { otelMetricsExport } from '../src/otel';
import { report } from '../src/report';

const bin = join(import.meta.dir, '..', 'bin', 'stint');
const FIXTURES = join(import.meta.dir, '..', '..', 'core', 'test', 'fixtures', 'metrics');
const readJson = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const IDS = ['T-0001', 'T-0002', 'T-0003', 'T-0004', 'T-0005', 'T-0006', 'T-0007', 'T-0008'];

/** The eight-task fixture as a workspace on disk, with the given metrics targets. */
function fixtureWorkspace(targets?: Record<string, { min?: number; max?: number }>): { dir: string; cleanup: () => void } {
  const { dir, cleanup } = tempDir('stint-cli-metrics-');
  for (const id of IDS) {
    const bundle = readJson(`${id}.json`);
    const taskDir = join(dir, '.stint', 'tasks', `${id}-${bundle.task.slug}`);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'task.json'), `${JSON.stringify(bundle.task, null, 2)}\n`);
    writeFileSync(join(taskDir, 'events.jsonl'), bundle.events.map((e: unknown) => JSON.stringify(e)).join('\n') + '\n');
  }
  const config = { ...structuredClone(DEFAULT_CONFIG), metrics: { outcomeWindowDays: 7, ...(targets ? { targets } : {}) } };
  writeFileSync(join(dir, '.stint', 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return { dir, cleanup };
}

const run = (dir: string, extra: string[]) => Bun.spawnSync(['bun', bin, 'metrics', '--window', 'all', '--repo', dir, ...extra], { stdout: 'pipe', stderr: 'pipe' });

test('R-061 Acceptance 6: stint metrics --check with a verify.tamper_escapes max of 0 exits 1 on the fixture and names the metric', () => {
  const { dir, cleanup } = fixtureWorkspace({ 'verify.tamper_escapes': { max: 0 } });
  try {
    const r = run(dir, ['--check']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain('verify.tamper_escapes');
  } finally {
    cleanup();
  }
});

test('R-061 Acceptance 6: without targets, stint metrics --check exits 0', () => {
  const { dir, cleanup } = fixtureWorkspace();
  try {
    const r = run(dir, ['--check']);
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    expect(r.stdout.toString()).toContain('verify.tamper_escapes');
    expect(r.stdout.toString()).toContain('small sample');
  } finally {
    cleanup();
  }
});

test('stint otel export --metrics writes gauge points with the attribute stint.metric.id', async () => {
  const { dir, cleanup } = fixtureWorkspace();
  try {
    const out = join(dir, 'metrics.otel.json');
    const r = await otelMetricsExport(dir, out);
    expect(r.points).toBeGreaterThan(0);
    const body = JSON.parse(readFileSync(out, 'utf8')) as { resourceMetrics: Array<{ scopeMetrics: Array<{ metrics: Array<{ gauge: { dataPoints: Array<{ attributes: Array<{ key: string; value: { stringValue: string } }>; asDouble: number }> } }> }> }> };
    const points = body.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.gauge.dataPoints ?? [];
    expect(points.length).toBe(r.points);
    expect(points.every((p) => p.attributes[0]?.key === 'stint.metric.id')).toBe(true);
    expect(points.some((p) => p.attributes[0]?.value.stringValue === 'verify.attempt_pass')).toBe(true);
  } finally {
    cleanup();
  }
});

test('stint report carries the metrics block', async () => {
  const { dir, cleanup } = fixtureWorkspace();
  try {
    const r = await report(dir);
    expect(r.metrics.some((l) => l.includes('verify.attempt_pass'))).toBe(true);
    expect(r.metrics.some((l) => l.includes('outcome.cost_per_good_merge'))).toBe(true);
  } finally {
    cleanup();
  }
});

test('stint metrics --json prints a validating stint.metrics/1 object', async () => {
  const { dir, cleanup } = fixtureWorkspace({ 'verify.tamper_escapes': { max: 0 } });
  try {
    const m = await workspaceMetrics(dir, { window: 'all', by: 'agent' });
    expect(MetricsSchema.safeParse(m).success).toBe(true);
    expect(missedTargets(m).map((v) => v.id)).toEqual(['verify.tamper_escapes']);
    expect(metricsLines(m).some((l) => l.includes('below target'))).toBe(true);
  } finally {
    cleanup();
  }
});
