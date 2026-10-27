import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { auth, fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

type Comment = { id: string; file: string; line: number; text: string; at: string; handedTo?: string };

const waitRuns = async (ws: { handoffs: (id: string) => { names: () => Promise<string[]> } }, id: string, n: number) => {
  for (let i = 0; i < 400 && (await ws.handoffs(id).names()).length < n; i++) await Bun.sleep(50);
};

test('A line comment is stored by the daemon, read back, and handed on once in the next ask', async () => {
  await withFixtureRepo(async (repo) => {
    const fake = fakeAdapter('edit');
    const { app, ws } = await makeApp(repo, [fake]);
    const t = await ws.createTask(newTask);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    await waitRuns(ws, t.id, 1);

    const empty = await app.request(`/api/tasks/${t.id}/comments`);
    expect(empty.status).toBe(200);
    expect((await empty.json()) as Comment[]).toEqual([]);

    const posted = await post(app, `/api/tasks/${t.id}/comments`, { file: 'src/lib/limiter.ts', line: 3, text: 'Read the limit from config' });
    expect(posted.status).toBe(201);
    const comments = (await posted.json()) as Comment[];
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ file: 'src/lib/limiter.ts', line: 3, text: 'Read the limit from config' });
    expect(typeof comments[0]?.id).toBe('string');
    expect(typeof comments[0]?.at).toBe('string');

    const onDisk = (await Bun.file(join(await ws.taskDir(t.id), 'comments.json')).json()) as Comment[];
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]?.text).toBe('Read the limit from config');

    const read = await app.request(`/api/tasks/${t.id}/comments`);
    expect(((await read.json()) as Comment[])[0]?.line).toBe(3);

    // the first hand carries the comment into the new run's ask, and marks it with that run
    const hand1 = (await (await post(app, `/api/tasks/${t.id}/hand`, { adapter: 'fake' })).json()) as { run: string };
    expect(hand1.run).toBe('r2');
    await waitRuns(ws, t.id, 3);
    expect(fake.seen[1]?.prompt).toContain('Review comments: src/lib/limiter.ts:3 Read the limit from config');
    const afterHand = (await (await app.request(`/api/tasks/${t.id}/comments`)).json()) as Comment[];
    expect(afterHand[0]?.handedTo).toBe('r2');

    // a second hand does not repeat a comment already handed on
    const hand2 = (await (await post(app, `/api/tasks/${t.id}/hand`, { adapter: 'fake' })).json()) as { run: string };
    expect(hand2.run).toBe('r3');
    for (let i = 0; i < 400 && fake.seen.length < 3; i++) await Bun.sleep(50);
    await waitRuns(ws, t.id, 5);
    expect(fake.seen[2]?.prompt).not.toContain('Review comments:');
  });
}, 120_000);

test('Comments with a bad file, line or text are refused as invalid and nothing is stored', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, []);
    const t = await ws.createTask(newTask);
    const bad: unknown[] = [
      { file: '', line: 1, text: 'hello' },
      { file: '../outside.ts', line: 1, text: 'hello' },
      { file: 'src/../outside.ts', line: 1, text: 'hello' },
      { file: '/abs.ts', line: 1, text: 'hello' },
      { file: 'src/a.ts', line: 0, text: 'hello' },
      { file: 'src/a.ts', line: 1.5, text: 'hello' },
      { file: 'src/a.ts', line: -2, text: 'hello' },
      { file: 'src/a.ts', line: 1, text: '' },
      { file: 'src/a.ts', line: 1, text: 'x'.repeat(2001) },
    ];
    for (const body of bad) {
      const res = await post(app, `/api/tasks/${t.id}/comments`, body);
      expect(res.status).toBe(400);
      const parsed = (await res.json()) as { error: { code: string } };
      expect(parsed.error.code).toBe('invalid');
    }
    const read = await app.request(`/api/tasks/${t.id}/comments`, { headers: auth });
    expect((await read.json()) as Comment[]).toEqual([]);
  });
}, 60_000);
