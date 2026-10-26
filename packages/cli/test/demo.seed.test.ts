import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { withFixtureRepo } from '../../daemon/test/helpers';
import { seedDemo } from '../src/demo/seed';

const gitLog = (repo: string) => Bun.spawnSync(['git', '-C', repo, 'log', '--format=%B', 'HEAD'], { stdout: 'pipe' }).stdout.toString();

test('stint demo seed twice on a fixture copy leaves exactly three tasks with T-0040 done and a merged commit carrying Stint-Task: T-0040', async () => {
  await withFixtureRepo(async (repo) => {
    const first = await seedDemo(repo);
    expect(first.created).toEqual(['T-0040', 'T-0042', 'T-0043']);
    const ws = await Workspace.open(repo);
    const counts = async () => {
      const out: Record<string, number> = {};
      for (const t of await ws.listTasks()) out[t.id] = (await ws.events(t.id).read()).length;
      return out;
    };
    const before = await counts();
    const second = await seedDemo(repo);
    expect(second.created).toEqual([]);
    expect(await counts()).toEqual(before);

    const tasks = await ws.listTasks();
    expect(tasks.map((t) => t.id)).toEqual(['T-0040', 'T-0042', 'T-0043']);
    expect(tasks.find((t) => t.id === 'T-0040')?.status).toBe('done');
    expect(tasks.find((t) => t.id === 'T-0042')).toMatchObject({ status: 'planned', testCommand: 'bun run test' });
    expect(tasks.find((t) => t.id === 'T-0042')?.acceptance).toHaveLength(3);
    expect(tasks.find((t) => t.id === 'T-0042')?.tags).toEqual(expect.arrayContaining(['limits', 'webhooks']));
    expect(tasks.find((t) => t.id === 'T-0043')).toMatchObject({ title: 'Rate-limit the admin API', status: 'planned' });
    expect(tasks.find((t) => t.id === 'T-0043')?.tags).toContain('limits');
    expect(gitLog(repo)).toContain('Stint-Task: T-0040');

    const context = JSON.parse(readFileSync(join(await ws.taskDir('T-0042'), 'context.json'), 'utf8')) as { files: Array<{ path: string }> };
    expect(context.files.map((f) => f.path)).toContain('src/routes/webhooks.ts');
    const review = await ws.readReview('T-0040');
    const f2 = review?.findings.find((f) => f.id === 'F2');
    expect(f2?.text.toLowerCase()).toContain('hard-coded');
    expect(f2?.text).toContain('loadConfig()');
    expect(f2?.linksTo).toBe('R2');
    expect((await ws.events('T-0040').read()).map((e) => e.type)).toContain('review.recorded');
  });
}, 60_000);

test('stint demo seed refuses while a daemon is running for the repository', async () => {
  await withFixtureRepo(async (repo) => {
    mkdirSync(join(repo, '.stint', 'cache'), { recursive: true });
    writeFileSync(join(repo, '.stint', 'cache', 'daemon.json'), JSON.stringify({ pid: process.pid, port: 0, token: 'x' }));
    expect(existsSync(join(repo, '.stint', 'cache', 'daemon.json'))).toBe(true);
    await expect(seedDemo(repo)).rejects.toThrow(/daemon is running/);
  });
}, 30_000);
