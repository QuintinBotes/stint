import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../../core/test/fixture';
import { scenarioPayload } from '../src/scenario';

test('stint scenario add stores one: a file inside the repository keeps its repository path, an outside file keeps its name', () => {
  const a = tempDir('stint-scenario-cli-');
  const b = tempDir('stint-scenario-out-');
  try {
    writeFileSync(join(a.dir, 'holdout.test.ts'), `test('x', () => {});\n`);
    expect(scenarioPayload(a.dir, join(a.dir, 'holdout.test.ts'))).toEqual({ name: 'holdout.test.ts', content: `test('x', () => {});\n` });
    writeFileSync(join(b.dir, 'secret.test.ts'), `test('y', () => {});\n`);
    expect(scenarioPayload(a.dir, join(b.dir, 'secret.test.ts')).name).toBe('secret.test.ts');
    expect(() => scenarioPayload(a.dir, join(a.dir, 'missing.test.ts'))).toThrow('no file');
  } finally {
    a.cleanup();
    b.cleanup();
  }
});
