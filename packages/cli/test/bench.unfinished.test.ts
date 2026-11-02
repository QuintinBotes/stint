import { expect, test } from 'bun:test';
import { testsLine } from '../../../scripts/unfinished-bench';

test('the unfinished bench reads the vitest summary line, and a held-out file that never ran counts as nothing passed', () => {
  expect(testsLine(' Test Files  1 failed (1)\n      Tests  2 failed | 1 passed (3)\n   Start at  20:28:51')).toEqual({ passed: 1, failed: 2, line: 'Tests  2 failed | 1 passed (3)' });
  expect(testsLine('      Tests  4 passed (4)\n')).toMatchObject({ passed: 4, failed: 0 });
  expect(testsLine('Error: Cannot find module ../src/lib/limiter\n')).toMatchObject({ passed: 0, failed: 0 });
});
