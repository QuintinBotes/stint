import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const REPO_URL = /^https:\/\/github\.com\/QuintinBotes\/stint\/(?:blob|tree)\/[^/]+\/([^#?]+)/;

/** Every link and image in the README that names this repository, as a relative path or a GitHub URL, and does not resolve to a file or folder in it (R-069 Acceptance 4). */
export function unresolvedLinks(text: string): string[] {
  const prose = text.replace(/^```[\s\S]*?^```/gm, '');
  const targets = [
    ...[...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] as string),
    ...[...prose.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] as string),
    ...[...prose.matchAll(/srcset="([^"]+)"/g)].map((m) => (m[1] as string).split(/\s/)[0] as string),
  ];
  const out: string[] = [];
  for (const target of new Set(targets)) {
    const path = REPO_URL.exec(target)?.[1] ?? (/^[a-z]+:|^#/.test(target) ? null : (target.split('#')[0] as string));
    if (path !== null && !existsSync(join(root, decodeURIComponent(path)))) out.push(target);
  }
  return out;
}

test('R-069 Acceptance 4: every link and image in README.md that names this repository resolves to a file or folder in it', () => {
  expect(unresolvedLinks(readme)).toEqual([]);
});

test('the link check names a missing file, a missing image and a repository URL to nothing, and lets other sites and in-page anchors through', () => {
  expect(unresolvedLinks('[a](docs/nothing.md) <img src="assets/nothing.png"> [b](https://github.com/QuintinBotes/stint/blob/main/no/such/file.ts)')).toEqual([
    'docs/nothing.md',
    'https://github.com/QuintinBotes/stint/blob/main/no/such/file.ts',
    'assets/nothing.png',
  ]);
  expect(unresolvedLinks('[a](docs/setup.md#keys) [b](#quick-start) [c](https://bun.sh) [d](https://github.com/QuintinBotes/stint/tree/main/docs)')).toEqual([]);
});
