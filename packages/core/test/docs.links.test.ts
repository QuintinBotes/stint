import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');

const markdown = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? markdown(path) : name.endsWith('.md') ? [path] : [];
  });

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens. */
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');

const anchors = (file: string) => new Set(readFileSync(file, 'utf8').split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, ''))));

/** Every relative link and image target in one markdown file that does not resolve. Code blocks are skipped. */
export function brokenLinks(file: string, text: string): string[] {
  const prose = text.replace(/^```[\s\S]*?^```/gm, '');
  const targets = [
    ...[...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1] as string),
    ...[...prose.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] as string),
    ...[...prose.matchAll(/srcset="([^"]+)"/g)].flatMap((m) => (m[1] as string).split(',').map((s) => s.trim().split(/\s+/)[0] as string)),
  ];
  const out: string[] = [];
  for (const target of new Set(targets)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split('#') as [string, string | undefined];
    const resolved = path ? join(dirname(file), decodeURIComponent(path)) : file;
    const where = `${relative(root, file)}: ${target}`;
    if (!existsSync(resolved)) out.push(`${where} does not exist`);
    else if (anchor && resolved.endsWith('.md') && !anchors(resolved).has(anchor)) out.push(`${where} has no heading with that anchor`);
  }
  return out;
}

test('R-059 Acceptance 3: every relative link and image in the README and docs/ resolves', () => {
  const files = [join(root, 'README.md'), ...markdown(join(root, 'docs'))];
  expect(files.length).toBeGreaterThan(10);
  expect(files.flatMap((f) => brokenLinks(f, readFileSync(f, 'utf8')))).toEqual([]);
});

test('a link to a missing file, a missing anchor or a missing image fails the check', () => {
  const readme = join(root, 'README.md');
  expect(brokenLinks(readme, '[x](docs/nothing.md)')).toEqual([expect.stringContaining('does not exist')]);
  expect(brokenLinks(readme, '[x](docs/setup.md#no-such-heading)')).toEqual([expect.stringContaining('no heading')]);
  expect(brokenLinks(readme, '<img src="assets/nothing.png">')).toEqual([expect.stringContaining('does not exist')]);
  expect(brokenLinks(readme, '[x](docs/setup.md#keys) and [y](https://example.com/x)')).toEqual([]);
});
