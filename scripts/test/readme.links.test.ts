import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Glob } from 'bun';

const root = join(import.meta.dir, '..', '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const REPO_URL = /^https:\/\/github\.com\/QuintinBotes\/stint\/(?:blob|tree)\/[^/]+\/([^#?]+)/;

/** Every link and image in a page that names this repository, as a path relative to the page's folder or a GitHub URL, and does not resolve to a file or folder in it (R-069 Acceptance 4). */
export function unresolvedLinks(text: string, dir = root): string[] {
  const prose = text.replace(/^```[\s\S]*?^```/gm, '');
  const targets = [
    ...[...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] as string),
    ...[...prose.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] as string),
    ...[...prose.matchAll(/srcset="([^"]+)"/g)].map((m) => (m[1] as string).split(/\s/)[0] as string),
  ];
  const out: string[] = [];
  for (const target of new Set(targets)) {
    const repoPath = REPO_URL.exec(target)?.[1];
    const path = repoPath !== undefined ? join(root, repoPath) : /^[a-z]+:|^#/.test(target) ? null : join(dir, target.split('#')[0] as string);
    if (path !== null && !existsSync(decodeURIComponent(path))) out.push(target);
  }
  return out;
}

/** Every path a page names in backticks under one of the repository's top-level folders that does not exist. `.stint/` is the state Stint writes in a repository at run time, so it is not checked. */
export function missingCitedPaths(text: string): string[] {
  const prose = text.replace(/^```[\s\S]*?^```/gm, '');
  const cited = new Set([...prose.matchAll(/`([\w.-]+\/[\w./-]*)`/g)].map((m) => m[1] as string));
  return [...cited].filter((p) => !p.startsWith('.stint/') && existsSync(join(root, p.split('/')[0] as string)) && !existsSync(join(root, p)));
}

const docs = [...new Glob('docs/**/*.md').scanSync(root)].sort();

test('R-069 Acceptance 4: every link and image in README.md that names this repository resolves to a file or folder in it', () => {
  expect(unresolvedLinks(readme)).toEqual([]);
});

test('every path README.md names in backticks exists in the repository', () => {
  expect(missingCitedPaths(readme)).toEqual([]);
});

test('every link and image in docs/ that names this repository resolves to a file or folder in it', () => {
  const broken = docs.map((f) => [f, unresolvedLinks(readFileSync(join(root, f), 'utf8'), dirname(join(root, f)))] as const).filter(([, links]) => links.length > 0);
  expect(docs.length).toBeGreaterThan(20);
  expect(Object.fromEntries(broken)).toEqual({});
});

test('the link check names a missing file, a missing image and a repository URL to nothing, and lets other sites and in-page anchors through', () => {
  expect(unresolvedLinks('[a](docs/nothing.md) <img src="assets/nothing.png"> [b](https://github.com/QuintinBotes/stint/blob/main/no/such/file.ts)')).toEqual([
    'docs/nothing.md',
    'https://github.com/QuintinBotes/stint/blob/main/no/such/file.ts',
    'assets/nothing.png',
  ]);
  expect(unresolvedLinks('[a](docs/setup.md#keys) [b](#quick-start) [c](https://bun.sh) [d](https://github.com/QuintinBotes/stint/tree/main/docs)')).toEqual([]);
});

test('a page in docs/ resolves its links from its own folder', () => {
  expect(unresolvedLinks('[a](setup.md#keys) [b](../README.md) [c](adr/) [d](docs/setup.md)', join(root, 'docs'))).toEqual(['docs/setup.md']);
});

test('the cited-path check names a missing file under a real folder, and lets through real files, runtime state, commands and names outside the repository', () => {
  expect(missingCitedPaths('`packages/core/src/nothing.ts` `bench/no-such/` `docs/setup.md` `packages/core/src/` `.stint/tasks/T-0001/` `bash scripts/bootstrap.sh` `ghcr.io/quintinbotes/stint` `stint.handoff/1`')).toEqual([
    'packages/core/src/nothing.ts',
    'bench/no-such/',
  ]);
});
