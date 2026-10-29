import { expect, test } from 'bun:test';
import { type StintEvent, learningCurve, learningWords } from '../src/index';

const ev = (task: string, type: string, ts: string, payload: Record<string, unknown>) => ({ task, type, ts, payload, vendor: 'daemon' }) as unknown as StintEvent;
const review = (task: string, ts: string, findings: number, extra: Record<string, unknown> = {}) => ev(task, 'review.recorded', ts, { verdict: 'approve', findings, ...extra });

// the replay's story at its recorded times, whose precision differs line to line, as the logs hand it over: task by task
const replay = [
  ev('T-0040', 'task.created', '2026-10-26T15:00:00Z', {}),
  review('T-0040', '2026-10-26T15:00:00.400Z', 2),
  ev('T-0043', 'task.created', '2026-10-26T15:00:01Z', {}),
  review('T-0043', '2026-10-26T15:02:32Z', 0),
  review('T-0042', '2026-10-26T15:01:59Z', 2),
  ev('T-0042', 'merge.completed', '2026-10-26T15:02:05.500Z', { commit: 'a'.repeat(40) }),
  ev('T-0042', 'skill.approved', '2026-10-26T15:02:12Z', { id: 'limiter-config-via-env', by: 'human' }),
];

test('The learning curve has one point per reviewed task in the order reviewed, and the approval stands after the reviews before it (R-070)', () => {
  expect(learningCurve(replay)).toEqual({
    points: [
      { task: 'T-0040', findings: 2, at: '2026-10-26T15:00:00.400Z' },
      { task: 'T-0042', findings: 2, at: '2026-10-26T15:01:59Z' },
      { task: 'T-0043', findings: 0, at: '2026-10-26T15:02:32Z' },
    ],
    approvals: [{ skill: 'limiter-config-via-env', at: '2026-10-26T15:02:12Z', after: 2 }],
  });
  expect(learningWords(learningCurve(replay))).toBe('Findings fell from 2 on T-0042 to 0 on T-0043 after limiter-config-via-env was approved.');
});

test("A task's last review is its point, a skill counts at its first approval wherever it is logged, and a review with no count is not a point", () => {
  const curve = learningCurve([
    review('T-0001', '2026-10-27T10:00:00Z', 4),
    // asked for changes, built again, reviewed per lens and then combined: the combined review is written last
    review('T-0001', '2026-10-27T12:00:00Z', 2, { lens: 'general' }),
    review('T-0001', '2026-10-27T12:00:01Z', 1, { lens: 'combined' }),
    ev('T-0001', 'skill.approved', '2026-10-27T11:00:00Z', { id: 'retry-with-jitter' }),
    review('T-0002', '2026-10-27T11:30:00Z', 3),
    ev('T-0002', 'review.recorded', '2026-10-27T13:00:00Z', { verdict: 'approve' }),
    // a skill approved again after an edit, and one from the registry with no task, on the workspace log
    ev('workspace', 'skill.approved', '2026-10-27T14:00:00Z', { id: 'retry-with-jitter' }),
    // half a second after T-0002's review, written with more precision than it: compared as times, not as strings
    ev('workspace', 'skill.approved', '2026-10-27T11:30:00.500Z', { id: 'imported-style' }),
    ev('workspace', 'skill.approved', '2026-10-27T15:00:00Z', {}),
  ]);
  expect(curve).toEqual({
    points: [
      { task: 'T-0002', findings: 3, at: '2026-10-27T11:30:00Z' },
      { task: 'T-0001', findings: 1, at: '2026-10-27T12:00:01Z' },
    ],
    approvals: [
      { skill: 'retry-with-jitter', at: '2026-10-27T11:00:00Z', after: 0 },
      { skill: 'imported-style', at: '2026-10-27T11:30:00.500Z', after: 1 },
    ],
  });
  expect(learningWords(curve)).toBe('Every task here was reviewed after retry-with-jitter was approved. Findings fell from 3 on T-0002 to 1 on T-0001 after imported-style was approved.');
});

test('The words say a rise, no change, nothing reviewed since, and no approval yet', () => {
  const points = [
    { task: 'T-0010', findings: 1, at: '2026-10-27T10:00:00Z' },
    { task: 'T-0011', findings: 3, at: '2026-10-27T11:00:00Z' },
    { task: 'T-0012', findings: 3, at: '2026-10-27T12:00:00Z' },
  ];
  expect(
    learningWords({
      points,
      approvals: [
        { skill: 'a', at: '2026-10-27T10:30:00Z', after: 1 },
        { skill: 'b', at: '2026-10-27T11:30:00Z', after: 2 },
        { skill: 'c', at: '2026-10-27T12:30:00Z', after: 3 },
      ],
    }),
  ).toBe('Findings rose from 1 on T-0010 to 3 on T-0011 after a was approved. Findings stayed at 3 from T-0011 to T-0012 after b was approved. No task has been reviewed since c was approved.');
  expect(learningWords({ points, approvals: [] })).toBe('No skill has been approved yet.');
  expect(learningCurve([])).toEqual({ points: [], approvals: [] });
});
