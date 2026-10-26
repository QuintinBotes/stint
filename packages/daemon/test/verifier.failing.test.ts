import { expect, test } from 'bun:test';
import { failingTests } from '../src/index';

test('failing test names are read from bun and Vitest output', () => {
  expect(failingTests('(pass) a [1ms]\n(fail) limiter > answers 429 [2.10ms]\n 3 pass\n 1 fail\n')).toEqual(['limiter > answers 429']);
  expect(failingTests(' FAIL  test/ratelimit.test.ts > webhooks > answers 429 with Retry-After\n Tests  1 failed | 32 passed\n')).toEqual(['test/ratelimit.test.ts > webhooks > answers 429 with Retry-After']);
  expect(failingTests(' 33 pass\n 0 fail\n')).toEqual([]);
});
