import { expect, test } from 'bun:test';
import { relayFromEvents } from '../src/node';
import type { StintEvent } from '../src/schemas/event';

const ev = (seq: number, run: string, adapter: string, type: string, ts: string, payload: Record<string, unknown>) =>
  ({ id: `e${seq}`, seq, ts, task: 'T-0042', run, adapter, vendor: 'meta', type, payload }) as unknown as StintEvent;

// the shapes of the 30 October live take: r4 started on Glimmer and Baseten answered, r3 learned its model as it ran
const take = [
  ev(1, 'r3', 'stint-agent', 'run.started', '2026-10-30T10:52:00Z', { role: 'implementer', host: 'local-cli' }),
  ev(2, 'r3', 'stint-agent', 'run.finished', '2026-10-30T10:54:00Z', { endedBy: 'completed', host: 'meta-api', model: 'muse-spark-1.3' }),
  ev(3, 'r4', 'openai-compatible', 'run.started', '2026-10-30T10:55:00Z', { role: 'reviewer', host: 'ollama', model: 'muse-glimmer:30b-mlx' }),
  ev(4, 'r4', 'openai-compatible', 'run.finished', '2026-10-30T10:55:30Z', { endedBy: 'completed', host: 'baseten', model: 'muse-spark-open' }),
];

test('A run sits on the lane of whoever finished it: a review that fell through to Baseten, and the Stint agent once its model is known', () => {
  const relay = relayFromEvents([{ task: 'T-0042', events: take }]);
  expect(relay.runs.map((r) => [r.run, r.lane])).toEqual([
    ['r3', 'stint-agent:muse-spark-1.3'],
    ['r4', 'baseten/muse-spark-open'],
  ]);
  expect(relay.lanes.map((l) => [l.id, l.roles])).toEqual([
    ['stint-agent:muse-spark-1.3', ['implementer']],
    ['baseten/muse-spark-open', ['reviewer']],
  ]);
});

test('A run still going stays on the lane it started on', () => {
  const relay = relayFromEvents([{ task: 'T-0042', events: take.slice(0, 3) }]);
  expect(relay.runs.map((r) => [r.run, r.lane])).toEqual([
    ['r3', 'stint-agent:muse-spark-1.3'],
    ['r4', 'ollama/muse-glimmer:30b-mlx'],
  ]);
});

test('Lanes of one role follow the order the agents first worked, so a relay reads from the top down', () => {
  const relay = relayFromEvents([
    {
      task: 'T-0001',
      events: [
        ev(1, 'r1', 'muse-code', 'run.started', '2026-10-29T14:10:32Z', { role: 'implementer', model: 'muse-spark-1.3', host: 'local-cli' }),
        ev(2, 'r1', 'muse-code', 'run.finished', '2026-10-29T14:10:51Z', { endedBy: 'killed', model: 'muse-spark-1.3', host: 'local-cli' }),
        ev(3, 'r2', 'claude-code', 'run.started', '2026-10-29T14:13:20Z', { role: 'implementer', host: 'local-cli' }),
        ev(4, 'r2', 'claude-code', 'run.finished', '2026-10-29T14:28:20Z', { endedBy: 'killed', model: 'muse-glimmer:30b-mlx', host: 'ollama' }),
        ev(5, 'r3', 'codex', 'run.started', '2026-10-29T14:30:49Z', { role: 'implementer', host: 'local-cli' }),
        ev(6, 'r3', 'codex', 'run.finished', '2026-10-29T14:33:29Z', { endedBy: 'completed', model: 'muse-spark-1.3', host: 'meta-api' }),
      ],
    },
  ]);
  expect(relay.lanes.map((l) => l.id)).toEqual(['muse-code:muse-spark-1.3', 'claude-code:muse-glimmer:30b-mlx', 'codex:muse-spark-1.3']);
});
