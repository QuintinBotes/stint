import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, metrics, type MetricsInput } from '../src/index';
import { ALL_TAGS, scoreboard } from '../src/node';

const FIXTURES = join(import.meta.dir, 'fixtures', 'metrics');
const readJson = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const NOW = '2026-11-10T00:00:00.000Z';

const input: MetricsInput = {
  tasks: ['T-0001', 'T-0002', 'T-0003', 'T-0004', 'T-0005', 'T-0006', 'T-0007', 'T-0008'].map((id) => readJson(`${id}.json`)),
  skills: readJson('skills.json'),
  golden: readJson('golden.json'),
  config: DEFAULT_CONFIG,
  now: NOW,
  window: { from: null, to: NOW },
};

describe('R-061 Acceptance 2: on the same fixture, scoreboard() attempt pass rates equal verify.attempt_pass by agent and model', () => {
  test('attempt pass rates agree per agent (tag *)', () => {
    const rows = scoreboard(input.tasks);
    const m = metrics({ ...input, by: 'agent' });
    for (const agent of ['muse-code', 'stint-agent']) {
      const mine = rows.filter((r) => r.tag === ALL_TAGS && r.agent === agent);
      const attempts = mine.reduce((s, r) => s + r.attempts, 0);
      const passed = mine.reduce((s, r) => s + r.passed, 0);
      const metric = m.breakdown?.find((b) => b.key === agent)?.metrics.find((v) => v.id === 'verify.attempt_pass');
      expect(metric?.n).toBe(attempts);
      expect(metric?.value).toBe(passed / attempts);
    }
    // The overall rate is the scoreboard's pooled rate at tag *.
    const attempts = rows.filter((r) => r.tag === ALL_TAGS).reduce((s, r) => s + r.attempts, 0);
    const passed = rows.filter((r) => r.tag === ALL_TAGS).reduce((s, r) => s + r.passed, 0);
    const overall = Object.values(metrics(input).groups).flat().find((v) => v.id === 'verify.attempt_pass');
    expect(overall).toMatchObject({ value: passed / attempts, n: attempts });
  });

  test('attempt pass rates agree per model', () => {
    const rows = scoreboard(input.tasks);
    const m = metrics({ ...input, by: 'model' });
    for (const model of ['muse-spark-1.3', 'muse-spark-open']) {
      const mine = rows.filter((r) => r.tag === ALL_TAGS && r.model === model);
      const attempts = mine.reduce((s, r) => s + r.attempts, 0);
      const passed = mine.reduce((s, r) => s + r.passed, 0);
      const metric = m.breakdown?.find((b) => b.key === model)?.metrics.find((v) => v.id === 'verify.attempt_pass');
      expect(metric?.n).toBe(attempts);
      expect(metric?.value).toBe(passed / attempts);
    }
  });

  // Tamper escapes and golden pass^k need phaseGates(), which lives in the daemon;
  // that half of Acceptance 2 is packages/daemon/test/metrics.agree.test.ts.
});
