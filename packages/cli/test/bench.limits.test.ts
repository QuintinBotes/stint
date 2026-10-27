import { expect, test } from 'bun:test';
import { TokenBucket, type BenchClock } from '../src/bench/limits';

/** A clock that only moves when the bucket sleeps, so waits are exact and no hosted model is called. */
function fakeClock(): BenchClock & { at: () => number } {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

// R-055 acceptance 4: the token bucket holds a third concurrent call until the window frees.
test('The token bucket holds a third concurrent call until the window frees', async () => {
  const clock = fakeClock();
  const bucket = new TokenBucket({ rpm: 2 }, clock);
  const doneAt: number[] = [];
  await Promise.all([
    bucket.acquire(10).then(() => doneAt.push(clock.at())),
    bucket.acquire(10).then(() => doneAt.push(clock.at())),
    bucket.acquire(10).then(() => doneAt.push(clock.at())),
  ]);
  expect(doneAt).toEqual([0, 0, 30_000]);
  expect(clock.at()).toBe(30_000);
});

test('The token bucket waits for tokens as well as requests, and never fails a call for an empty bucket', async () => {
  const clock = fakeClock();
  const bucket = new TokenBucket({ tpm: 100 }, clock);
  await bucket.acquire(60);
  expect(clock.at()).toBe(0);
  // 40 tokens are left and 60 are asked for: 20 more refill at 100 a minute, which takes 12 seconds
  await bucket.acquire(60);
  expect(clock.at()).toBe(12_000);
});
