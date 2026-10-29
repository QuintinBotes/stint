import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';
import { fakeAdapter, newTask, withFixtureRepo } from '../../daemon/test/helpers';

const stint = async (repo: string, ...args: string[]) => {
  const p = Bun.spawn(['bun', join(import.meta.dir, '..', 'bin', 'stint'), ...args, '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
};

test('stint verify asks the daemon to run the tests and prints the result, exiting 1 when they fail; with nothing built it prints the refusal', async () => {
  await withFixtureRepo(async (repo) => {
    const d = await startDaemon({ root: repo, quiet: true, adapters: [fakeAdapter('edit')] });
    try {
      const built = async (testCommand: string) => {
        const t = await d.ws.createTask({ ...newTask, testCommand });
        await fetch(`${d.url}/api/tasks/${t.id}/assign`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'fake', role: 'implementer' }) });
        for (let i = 0; i < 600 && !(await d.ws.events(t.id).read()).some((e) => e.type === 'handoff.created'); i++) await Bun.sleep(50);
        return t.id;
      };
      const green = await built('true');
      const ok = await stint(repo, 'verify', green);
      expect(ok.code).toBe(0);
      expect(ok.stdout).toMatch(new RegExp(`^${green} r1 green: 1 passed, 0 failed in \\d+\\.\\d s, run by Stint \\(true\\)\\n$`));
      expect((await d.ws.events(green).read()).filter((e) => e.type === 'verification.ran')).toHaveLength(2);

      const red = await built('false');
      const bad = await stint(repo, 'verify', red, '--json');
      expect(bad.code).toBe(1);
      expect(JSON.parse(bad.stdout)).toMatchObject({ run: 'r1', status: 'red', command: 'false', runBy: 'daemon' });

      const none = await d.ws.createTask(newTask);
      const refused = await stint(repo, 'verify', none.id);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toBe(`not_found: ${none.id} has nothing to verify (a run creates the task branch)\n`);
    } finally {
      await d.stop();
    }
  });
}, 120_000);
