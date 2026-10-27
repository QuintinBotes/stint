import { expect, test } from 'bun:test';
import { BEATS, pausesAt, planBody, takePath } from '../src/demo/live';
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
