import { expect, test } from 'bun:test';
import type { Verification } from '../src/api';
import { coverageText, scenariosText, tamperText } from '../src/components/Verification';

const base: Verification = {
  run: 'r1',
  command: 'bun test',
  exitCode: 0,
  passed: 3,
  failed: 0,
  durationMs: 100,
  runBy: 'daemon',
  status: 'green',
  at: '2026-10-26T00:00:00.000Z',
};

test('the card shows the line "tests unchanged" (or the changed files and the decision that allowed them)', () => {
  expect(tamperText({ ...base, tamper: null })).toBe('tests unchanged');
  expect(tamperText({ ...base, tamper: { files: ['test/x.test.ts'] } })).toContain('test/x.test.ts');
  expect(tamperText({ ...base, tamper: { files: ['test/x.test.ts'], allowedBy: 'D2: tests: test/x.test.ts changed because the cap moved' } })).toContain(
    'changed because the cap moved',
  );
  expect(tamperText(base)).toBeNull();
});

test('held-out scenarios and the coverage delta are shown on the card in plain words', () => {
  expect(scenariosText({ ...base, scenarios: { passed: 2, failed: 1, names: ['holdout.test.ts'] } })).toBe('Held-out scenarios: 2 passed, 1 failed');
  expect(scenariosText({ ...base, scenarios: null })).toBeNull();
  expect(coverageText({ ...base, coverage: { base: 50, branch: 80 } })).toBe('Coverage 50% on the base, 80% on the branch');
  expect(coverageText({ ...base, coverage: null, coverageReason: 'the runner gave no coverage summary' })).toContain('the runner gave no coverage summary');
  expect(coverageText({ ...base, coverage: null })).toBeNull();
});
