import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '../src/node';
import { withFixtureRepo } from './fixture';

test('ten concurrent creates give ten distinct ids and ten folders', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const tasks = await Promise.all(Array.from({ length: 10 }, (_, i) => ws.createTask({ title: `Task ${i}`, goal: 'Do it.', acceptance: ['it is done'] })));
    expect(new Set(tasks.map((t) => t.id)).size).toBe(10);
    expect(readdirSync(join(repo, '.stint', 'tasks')).filter((n) => n.startsWith('T-'))).toHaveLength(10);
  });
}, 60_000);
