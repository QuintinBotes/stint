import { expect, test } from 'bun:test';
import { DaemonError, daemonMessage } from '../src/api';

const refusal = (message: string, hint: unknown) => new DaemonError(409, { code: 'x', message, hint });

test('a refusal reads as words: files are named, a budget hint is left to its message, never raw JSON', () => {
  const files = ['src/app.ts', 'src/lib/delivery.ts', 'src/lib/endpoints.ts', 'src/lib/signing.ts', 'src/routes/events.ts', 'test/signing.test.ts'];
  expect(daemonMessage(refusal('stint/T-0009 conflicts with main; ask for changes so an agent merges main into it', { files }))).toBe(
    'stint/T-0009 conflicts with main; ask for changes so an agent merges main into it. Files: src/app.ts, src/lib/delivery.ts, src/lib/endpoints.ts, src/lib/signing.ts and 2 more.',
  );
  expect(daemonMessage(refusal('the implementer budget on T-0009 would be exceeded', { spent: 1, prompt: 2, cap: 3 }))).toBe('the implementer budget on T-0009 would be exceeded');
  expect(daemonMessage(refusal('builds: too big', 'builds 1 to 50'))).toBe('builds: too big. builds 1 to 50');
});
