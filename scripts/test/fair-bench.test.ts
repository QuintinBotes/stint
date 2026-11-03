import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../../packages/core/test/fixture';
import { loadScenarios, publishRuns, taskSpend } from '../fair-bench';
import { table } from '../review-recheck';

const row = (id: string, type: string, usd: number | null, run?: string) => JSON.stringify({ id, type, ...(run ? { run } : {}), payload: { cost: { usd } } });

test('taskSpend counts the shared first run once, each continued run once, and a digest call as spend', () => {
  const tmp = tempDir('stint-fair-');
  try {
    const shared = [row('e1', 'run.started', null, 'r1'), row('e2', 'run.finished', 0.1, 'r1'), row('e3', 'cost.recorded', 0.004)];
    const arms: Array<[string, string[]]> = [
      ['t-packet-r1', [...shared, row('a1', 'run.finished', 0.05, 'r2')]],
      ['t-diff-r1', [...shared, row('b1', 'run.finished', 0.03, 'r2'), row('b2', 'cost.recorded', null)]],
      ['other-packet-r1', [row('x1', 'run.finished', 9, 'r1')]],
    ];
    for (const [dir, lines] of arms) {
      mkdirSync(join(tmp.dir, dir));
      writeFileSync(join(tmp.dir, dir, 'events.jsonl'), `${lines.join('\n')}\n`);
    }
    expect(taskSpend(tmp.dir, 't')).toEqual({ firstRunUsd: 0.104, continuedUsd: 0.08, unpriced: ['t-diff-r1 cost.recorded'] });
  } finally {
    tmp.cleanup();
  }
});

test('loadScenarios names each held-out file by its path without .txt', () => {
  const tmp = tempDir('stint-fair-');
  try {
    mkdirSync(join(tmp.dir, 'task-a', 'test'), { recursive: true });
    writeFileSync(join(tmp.dir, 'task-a', 'test', 'holdout.test.ts.txt'), 'held');
    expect(loadScenarios(tmp.dir)).toEqual({ 'task-a': [{ name: 'test/holdout.test.ts', content: 'held' }] });
  } finally {
    tmp.cleanup();
  }
});

test('the recheck table counts a flag on a red patch as caught and on a green one as wrongly blocked, and leaves out no answer', () => {
  expect(
    table([
      { hidden: 'red', verdict: 'request_changes' },
      { hidden: 'red', verdict: 'approve' },
      { hidden: 'green', verdict: 'block' },
      { hidden: 'green', verdict: 'approve' },
      { hidden: 'red', verdict: null },
    ]),
  ).toEqual({ caught: 1, red: 2, wronglyBlocked: 1, green: 2, unanswered: 1 });
});

test('publishing grades a recorded row on its held-out tests alone: a red verdict with none of them failing reads as held-out passed', () => {
  const tmp = tempDir('stint-fair-');
  try {
    const recorded = { task: 't', mode: 'diff', repeat: 1, leg: 'build', result: 'not verified by the daemon; with the held-out tests red', verified: false, hidden: 'red', scenarios: { passed: 5, failed: 0 } };
    mkdirSync(join(tmp.dir, 't-diff-r1'));
    writeFileSync(join(tmp.dir, 't-diff-r1', 'row.json'), `${JSON.stringify(recorded, null, 2)}\n`);
    publishRuns(tmp.dir);
    expect(JSON.parse(readFileSync(join(tmp.dir, 't-diff-r1', 'row.json'), 'utf8'))).toEqual({ ...recorded, result: "the daemon's verdict red; held-out tests passed 5 of 5", hidden: 'green' });
  } finally {
    tmp.cleanup();
  }
});
