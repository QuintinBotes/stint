import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, metrics, type MetricsInput } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { phaseGates } from '../src/index';
import { tempDir } from './helpers';

// The daemon half of R-061 Acceptance 2: phaseGates() lives here, so its agreement
// with metrics() is checked here, on the same eight-task fixture as the core tests.
const FIXTURES = join(import.meta.dir, '..', '..', 'core', 'test', 'fixtures', 'metrics');
const readJson = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const NOW = '2026-11-10T00:00:00.000Z';
const IDS = ['T-0001', 'T-0002', 'T-0003', 'T-0004', 'T-0005', 'T-0006', 'T-0007', 'T-0008'];

test('R-061 Acceptance 2: phaseGates() tamper escapes equal verify.tamper_escapes, and golden pass^k agrees', async () => {
  const { dir, cleanup } = tempDir('stint-metrics-agree-');
  try {
    for (const id of IDS) {
      const bundle = readJson(`${id}.json`);
      const taskDir = join(dir, '.stint', 'tasks', `${id}-${bundle.task.slug}`);
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(join(taskDir, 'task.json'), `${JSON.stringify(bundle.task, null, 2)}\n`);
      writeFileSync(join(taskDir, 'events.jsonl'), bundle.events.map((e: unknown) => JSON.stringify(e)).join('\n') + '\n');
    }
    mkdirSync(join(dir, 'bench'), { recursive: true });
    writeFileSync(
      join(dir, 'bench', 'golden-results.json'),
      `${JSON.stringify({ version: 'stint.golden/1', k: 3, passAt1: 0.9, passPowK: 0.8, taskCount: 10, cost: { usd: 1 } }, null, 2)}\n`,
    );
    const ws = await Workspace.open(dir);
    const gates = await phaseGates(ws);
    const input: MetricsInput = {
      tasks: IDS.map((id) => readJson(`${id}.json`)),
      skills: readJson('skills.json'),
      golden: readJson('golden.json'),
      config: DEFAULT_CONFIG,
      now: NOW,
      window: { from: null, to: NOW },
    };
    const all = Object.values(metrics(input).groups).flat();
    expect(all.find((v) => v.id === 'verify.tamper_escapes')?.value).toBe(gates.phase2.tamperEscapes);
    expect(all.find((v) => v.id === 'verify.golden_passk')?.value).toBe(gates.golden?.passPowK);
    expect(all.find((v) => v.id === 'verify.golden_pass1')?.value).toBe(gates.golden?.passAt1);
  } finally {
    cleanup();
  }
});
