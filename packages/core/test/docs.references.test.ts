import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const specs = join(import.meta.dir, '..', '..', '..', 'specs');
// R-058 itself names these phrases to say what must go, so it is the one file the rule cannot cover
const SELF = 'R-058-no-client-names.md';

test('R-058 Acceptance 6: no file under specs/ contains "spec doc", "artboard", "wireframe", or "the kit\'s"', () => {
  const found: string[] = [];
  for (const name of readdirSync(specs).filter((f) => f.endsWith('.md') && f !== SELF)) {
    readFileSync(join(specs, name), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/spec doc|artboard|wireframe|the kit's/i.test(line)) found.push(`${name}:${i + 1}`);
      });
  }
  expect(found).toEqual([]);
});
