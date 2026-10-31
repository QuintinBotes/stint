import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';
import { withFixtureRepo } from '../../daemon/test/helpers';

// async: the daemon answers in this process, so a blocking spawn would wait on itself
async function stint(...args: string[]) {
  const p = Bun.spawn(['bun', join(import.meta.dir, '..', 'bin', 'stint'), ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, exitCode };
}

test('stint new --max-… sets the task limits, stint limits prints the meters and changes them through the daemon, and --none takes one off', async () => {
  await withFixtureRepo(async (repo) => {
    const d = await startDaemon({ root: repo, quiet: true, adapters: [] });
    try {
      const made = await stint('new', 'Limit me', '--max-builds', '2', '--max-usd', '3', '--max-minutes', '30', '--repo', repo);
      expect(made.exitCode).toBe(0);
      const id = made.stdout.trim();
      expect((await d.ws.readTask(id)).limits).toEqual({ builds: 2, usd: 3, minutes: 30 });

      const shown = await stint('limits', id, '--repo', repo);
      expect(shown.exitCode).toBe(0);
      expect(shown.stdout.split('\n')).toEqual([
        'Builds        0 of 2',
        'Hand-offs     0 of 3',
        'Review rounds 0 of 1',
        'Spend         $0.00 of $3.00',
        'Agent time    0 of 30 min',
        'Tokens        0 of 1200000, implementer',
        '',
      ]);

      const changed = await stint('limits', id, '--max-builds', '4', '--none', 'usd', '--repo', repo);
      expect(changed.exitCode).toBe(0);
      expect(changed.stdout).toContain('Builds        0 of 4');
      expect(changed.stdout).toContain('Spend         $0.00, no limit');
      expect((await d.ws.readTask(id)).limits).toEqual({ builds: 4, usd: null, minutes: 30 });
      expect((await d.ws.events(id).read()).filter((e) => e.type === 'limits.changed')).toHaveLength(1);
      const raised = await stint('limits', id, '--implementer-tokens', '300,000', '--repo', repo);
      expect(raised.stdout).toContain('Tokens        0 of 300000, implementer');
      expect((await d.ws.readTask(id)).budgets.implementer).toBe(300_000);

      const notNumber = await stint('limits', id, '--max-builds', 'many', '--repo', repo);
      expect(notNumber.exitCode).toBe(2);
      expect(notNumber.stderr).toContain('--max-builds must be a whole number, not many');
      const outOfRange = await stint('limits', id, '--max-builds', '0', '--repo', repo);
      expect(outOfRange.exitCode).toBe(1);
      expect(outOfRange.stderr).toStartWith('invalid: builds:');
    } finally {
      await d.stop();
    }
  });
}, 60_000);
