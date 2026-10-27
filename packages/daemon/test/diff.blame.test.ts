import { expect, test } from 'bun:test';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunRegistry, Worktrees, gitOk } from '../src/index';
import { auth, makeApp, newTask, post, withFixtureRepo } from './helpers';

type BlameReply = Array<{ path: string; added: number; removed: number; hunks?: Array<{ start: number; end: number; run: string }> }>;

const cost = { inputTokens: 10, cachedTokens: 0, outputTokens: 2, usd: 0 };

test('GET /diff?format=json&blame=1 attributes each range of lines to the run whose commit last wrote it', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const task = await ws.createTask(newTask);
    const wt = new Worktrees(ws, new RunRegistry());
    const { path } = await wt.create(task, 'r1');
    const file = join(path, 'src/lib/shared.ts');
    writeFileSync(file, 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
    const c1 = await wt.commit(task, 'r1', path, 'shared constants');
    await ws.events(task.id).append({ task: task.id, run: 'r1', vendor: 'daemon', type: 'run.finished', payload: { endedBy: 'completed', cost, commit: c1 } });

    // the second run rewrites line 1 and adds line 4; lines 2 and 3 stay the first run's
    writeFileSync(file, 'export const a = 10;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n');
    const c2 = await wt.commit(task, 'r2', path, 'tune a, add d');
    await ws.events(task.id).append({ task: task.id, run: 'r2', vendor: 'daemon', type: 'run.finished', payload: { endedBy: 'completed', cost, commit: c2 } });

    const blamed = (await (await app.request(`/api/tasks/${task.id}/diff?format=json&blame=1`)).json()) as BlameReply;
    const shared = blamed.find((f) => f.path === 'src/lib/shared.ts');
    expect(shared).toMatchObject({ added: 4, removed: 0 });
    expect(shared?.hunks).toEqual([
      { start: 1, end: 1, run: 'r2' },
      { start: 2, end: 3, run: 'r1' },
      { start: 4, end: 4, run: 'r2' },
    ]);

    // without blame=1 the reply is the plain numstat, ranges and all absent
    const plain = (await (await app.request(`/api/tasks/${task.id}/diff?format=json`)).json()) as BlameReply;
    expect(plain.find((f) => f.path === 'src/lib/shared.ts')).toEqual({ path: 'src/lib/shared.ts', added: 4, removed: 0 });
  });
}, 30_000);

test('The pending queue lists unsettled skill proposals and file-rename merges beside contradictions, and a noted rename leaves it', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const task = await ws.createTask(newTask);
    const other = await ws.createTask({ ...newTask, title: 'Tidy the config' });
    // another task already touches the file by its old name, so the graph holds it under that name
    await ws.events(other.id).append({ task: other.id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/config.ts', added: 2, removed: 0, run: 'r1' } });
    await ws.events(task.id).append({ task: task.id, run: 'r1', vendor: 'daemon', type: 'skill.proposed', payload: { id: 'config-via-env', evidence: [] } });

    const wt = new Worktrees(ws, new RunRegistry());
    const { path } = await wt.create(task, 'r1');
    renameSync(join(path, 'src/config.ts'), join(path, 'src/settings.ts'));
    const commit = await wt.commit(task, 'r1', path, 'rename config to settings');
    await ws.events(task.id).append({ task: task.id, vendor: 'daemon', type: 'merge.completed', payload: { branch: task.branch, into: 'main', commit } });
    const byHand = await gitOk(repo, ['diff', '-M', '--name-status', `${commit}^1`, commit]);
    expect(byHand).toContain('src/config.ts');

    type Pending = Array<{ id: string; kind: string; skill?: string; from?: string; to?: string }>;
    const pending = (await (await app.request('/api/graph/pending')).json()) as Pending;
    const skill = pending.find((p) => p.kind === 'skill');
    expect(skill?.skill).toBe('config-via-env');
    const rename = pending.find((p) => p.kind === 'rename-merge');
    expect(rename).toMatchObject({ from: 'src/config.ts', to: 'src/settings.ts' });

    const settled = await post(app, `/api/graph/pending/${rename?.id}`, { action: 'keep' }, auth);
    expect(settled.status).toBe(200);
    const after = (await (await app.request('/api/graph/pending')).json()) as Pending;
    expect(after.some((p) => p.id === rename?.id)).toBe(false);
  });
}, 30_000);
