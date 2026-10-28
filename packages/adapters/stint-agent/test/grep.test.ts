import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTool } from '../src/index';

const wt = mkdtempSync(join(tmpdir(), 'stint-grep-'));
afterAll(() => rmSync(wt, { recursive: true, force: true }));
mkdirSync(join(wt, 'src'));
writeFileSync(join(wt, 'src', 'limiter.ts'), 'export const LIMIT = 60;\nexport const WINDOW_MS = 1000;\n');
// Bun gives up on one such line after about 0.4 s, so thirty of them hold a grep on the main thread for about 12 s
writeFileSync(join(wt, 'src', 'slow.txt'), `${'a'.repeat(36)}b\n`.repeat(30));

const grep = (pattern: string, path = '.') => runTool('grep', { pattern, path }, wt, {}, new AbortController().signal);

test('a pathological pattern is stopped after 5 s with a tool error while the daemon stays responsive', async () => {
  let ticks = 0;
  const beat = setInterval(() => ticks++, 100);
  const t0 = performance.now();
  try {
    const r = await grep('(a+)+$');
    expect(r.ok).toBe(false);
    expect(r.output).toContain('the pattern took too long; make it simpler');
    expect(performance.now() - t0).toBeLessThan(6_500);
  } finally {
    clearInterval(beat);
  }
  // the event loop kept turning: about 50 beats in 5 s, not none
  expect(ticks).toBeGreaterThan(30);
}, 20_000);

test('a normal pattern finds the same lines as before', async () => {
  const r = await grep('LIMIT|WINDOW');
  expect(r.ok).toBe(true);
  expect(r.output).toBe('src/limiter.ts:1: export const LIMIT = 60;\nsrc/limiter.ts:2: export const WINDOW_MS = 1000;');
  expect((await grep('nothing-like-this')).output).toBe('no matches');
});

test('a pattern over 500 characters and an invalid pattern are tool errors, not exceptions', async () => {
  const long = await grep('a'.repeat(501));
  expect(long.ok).toBe(false);
  expect(long.output).toContain('500 characters');
  const bad = await grep('(unclosed');
  expect(bad.ok).toBe(false);
  expect(bad.output).toContain('not a valid regular expression');
});
