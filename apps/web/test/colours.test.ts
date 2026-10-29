import { expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The contrast targets DESIGN.md states, measured from tokens.css itself, in both themes and with prefers-contrast: more (R-065, R-067).
const src = join(import.meta.dir, '..', 'src');
const css = readFileSync(join(src, 'tokens.css'), 'utf8');

/** The custom properties set in the first `:root` block after `marker` (the dark base when the marker is ''). */
function block(marker: string): Record<string, string> {
  const from = marker ? css.indexOf(marker) : 0;
  if (from < 0) throw new Error(`tokens.css has no ${marker}`);
  const body = /:root\s*\{([\s\S]*?)\n\s*\}/.exec(css.slice(from))?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}

const rgb = (v: string): [number, number, number, number] => {
  if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).concat(1) as [number, number, number, number];
  const p = (/rgba?\(([^)]+)\)/.exec(v)?.[1] ?? '').split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)));
  return [(p[0] ?? 0) / 255, (p[1] ?? 0) / 255, (p[2] ?? 0) / 255, p[3] ?? 1];
};
const over = (fg: string, bg: string) => {
  const [r, g, b, a] = rgb(fg);
  const [R, G, B] = rgb(bg);
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)] as const;
};
const lum = ([r, g, b]: readonly number[]) => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r as number) + 0.7152 * lin(g as number) + 0.0722 * lin(b as number);
};
const ratio = (fg: string, bg: string) => {
  const [hi, lo] = [lum(over(fg, bg)), lum(over(bg, bg))].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ['shell', 'ground', 'panel', 'panel-2', 'surface-hover', 'surface-selected'];
const TEXT = ['ink', 'ink-2', 'ink-3', 'amber', 'green', 'red', 'violet'];
const MARKS = ['rule-strong', 'field', 'focus', 'meta', 'anthropic', 'openai', 'local'];

function misses(t: Record<string, string>): string[] {
  const out: string[] = [];
  const at = (k: string) => t[k] ?? (() => { throw new Error(`no --${k}`); })();
  for (const ink of TEXT) for (const s of SURFACES) if (ratio(at(ink), at(s)) < 4.5) out.push(`${ink} on ${s} ${ratio(at(ink), at(s)).toFixed(2)}`);
  for (const ink of ['amber', 'green', 'red', 'violet']) {
    const wash = over(at(`${ink}-wash`), at('panel'));
    const hex = `#${wash.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
    if (ratio(at(ink), hex) < 4.5) out.push(`${ink} on its wash ${ratio(at(ink), hex).toFixed(2)}`);
  }
  for (const s of ['shell', 'ground', 'panel']) if (ratio(at('ink-3'), at(s)) < 7) out.push(`ink-3 on ${s} ${ratio(at('ink-3'), at(s)).toFixed(2)} (7:1)`);
  for (const m of MARKS) for (const s of SURFACES) if (ratio(at(m), at(s)) < 3) out.push(`${m} on ${s} ${ratio(at(m), at(s)).toFixed(2)} (3:1)`);
  if (ratio(at('on-ink'), at('ink')) < 4.5) out.push('on-ink on ink');
  if (ratio(at('term-ink'), at('term')) < 4.5) out.push('term-ink on term');
  return out;
}

const dark = block('');
const light = { ...dark, ...block('@media (prefers-color-scheme: light) {') };
const themes: Array<[string, Record<string, string>]> = [
  ['dark', dark],
  ['dark with more contrast', { ...dark, ...block('@media (prefers-color-scheme: dark) and (prefers-contrast: more)') }],
  ['light', light],
  ['light with more contrast', { ...light, ...block('@media (prefers-color-scheme: light) and (prefers-contrast: more)') }],
];

for (const [name, tokens] of themes) {
  test(`The ${name} theme meets DESIGN.md's contrast targets: text 4.5:1 on every surface and its wash, ink-3 7:1, marks 3:1`, () => {
    expect(misses(tokens)).toEqual([]);
  });
}

test('The measure catches a miss: an ink-3 as dark as rule fails on every surface', () => {
  expect(misses({ ...dark, 'ink-3': dark.rule as string }).filter((m) => m.startsWith('ink-3')).length).toBeGreaterThan(0);
});

// R-067 Requirement 7: no literal colour in a component, so both themes reach every pixel
test('No component or module under apps/web/src names a literal colour; colours come from tokens.css', () => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) {
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z-])|\brgba?\(|\bhsla?\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) found.push(`${p.slice(src.length + 1)}:${i + 1}`);
        });
      }
    }
  };
  walk(src);
  expect(found).toEqual([]);
});
