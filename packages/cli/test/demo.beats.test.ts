import { expect, test } from 'bun:test';
import { BEATS, type Ev, handOn, pausesAt, planBody, takePath } from '../src/demo/live';
import { checkPreflight } from '../src/demo/preflight';

test('--from review runs the earlier beats without stopping and pauses from the review on; --offline-plan plans locally; --take 2 has its own folder', () => {
  expect(BEATS.filter((b) => pausesAt(b, 'review'))).toEqual(['review', 'approve', 'next']);
  expect(BEATS.filter((b) => pausesAt(b))).toEqual([...BEATS]);
  expect(planBody(true)).toEqual({ host: 'ollama' });
  expect(planBody(false)).toEqual({});
  expect(takePath('/repo', 2, '2026-10-27')).toBe('/repo/demo/recordings/2026-10-27-2/recording.jsonl');
});

test('preflight names the optional hosted keys with what each adds, and never requires them', async () => {
  const r = await checkPreflight({ env: { META_API_KEY: 'k', FIREWORKS_API_KEY: 'f' }, checkOllama: async () => true, checkMuse: () => true });
  expect(r.ok).toBe(true);
  expect(r.optional).toEqual([
    expect.objectContaining({ name: 'FIREWORKS_API_KEY', set: true, enables: expect.stringContaining('Fireworks') }),
    expect.objectContaining({ name: 'BASETEN_API_KEY', set: false, enables: expect.stringContaining('Baseten') }),
  ]);
});

test('a continuation that ends red is handed on from its packet, and the relay stops at the first green run', async () => {
  const log: Ev[] = [];
  const outcomes = ['red', 'green', 'green'];
  let n = 2;
  const client = {
    get: async () => ({ events: log }),
    post: async (path: string) => {
      expect(path).toBe('/api/tasks/T-0042/hand');
      n += 1;
      const run = `r${n}`;
      const status = outcomes.shift();
      log.push({ type: 'verification.ran', run, payload: { status, failed: status === 'red' ? 2 : 0 } }, { type: 'handoff.created', run, payload: {} });
      return { run, packet: `h${n - 1}` };
    },
  };
  const lines: string[] = [];
  const waitFor = async (pred: (es: Ev[]) => boolean, what: string) => {
    if (!pred(log)) throw new Error(`never saw ${what}`);
    return log;
  };
  const runs = await handOn({ client, task: 'T-0042', adapter: 'stint-agent', hops: 3, out: (l) => lines.push(l), waitFor });
  expect(runs).toEqual(['r3', 'r4']);
  expect(lines).toEqual(['Handed T-0042 to stint-agent as r3 from packet h2.', 'r3 ended with 2 tests failing; handing on from its packet.', 'Handed T-0042 to stint-agent as r4 from packet h3.']);
});
