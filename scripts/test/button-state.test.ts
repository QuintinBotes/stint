import { expect, test } from 'bun:test';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');

/**
 * A Button's colours come from its tone, and a conditional colour class in className loses to them in the
 * stylesheet, so the state never shows. Six toggles shipped that way before 27 Oct. State goes through
 * aria-pressed or aria-selected, which Button styles itself.
 */
test('no Button adds a colour class on a condition; toggles use aria-pressed or aria-selected', () => {
  const files = Bun.spawnSync(['git', 'ls-files', 'apps/web/src/*.tsx', 'apps/web/src/**/*.tsx'], { cwd: root, stdout: 'pipe' }).stdout.toString().split('\n').filter(Boolean);
  const offenders: string[] = [];
  for (const f of files) {
    const text = require('node:fs').readFileSync(join(root, f), 'utf8') as string;
    // a Button tag up to its className={cx( ... )}, across lines and past arrow functions; then a conditional colour inside
    for (const m of text.matchAll(/<Button\b(?:(?!<\/?[A-Za-z])[\s\S]){0,400}?className=\{cx\(([\s\S]*?)\)\}/g)) {
      if (/&&\s*'[^']*\b(border|text|bg)-(accent|good|bad|warn|ink|line)/.test(m[1] ?? '')) offenders.push(`${f}: ${m[0].replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
  expect(offenders, 'use aria-pressed or aria-selected; Button styles them').toEqual([]);
});
