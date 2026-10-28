import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GoalSchema } from '../src/index';
import { StoreError, Workspace } from '../src/node';
import { withFixtureRepo } from './fixture';

const goal = (i: number) => ({ title: `Goal ${i}`, outcome: 'Webhooks survive a noisy tenant.', criteria: ['429 with Retry-After', 'Other tenants are served'] });

test('ten concurrent goal creates give ten distinct G- ids and ten files, each a valid draft', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const goals = await Promise.all(Array.from({ length: 10 }, (_, i) => ws.createGoal(goal(i))));
    expect(new Set(goals.map((g) => g.id)).size).toBe(10);
    expect(goals.map((g) => g.id).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `G-${String(i + 1).padStart(4, '0')}`));
    expect(readdirSync(join(repo, '.stint', 'goals')).filter((n) => n.endsWith('.json'))).toHaveLength(10);
    for (const g of await ws.listGoals()) {
      expect(GoalSchema.safeParse(g).success).toBe(true);
      expect(g).toMatchObject({ status: 'draft', tasks: [], decisions: [], nonGoals: [], criteria: [{ text: '429 with Retry-After' }, { text: 'Other tenants are served' }] });
    }
  });
}, 60_000);

test('goal edits run one at a time, are validated, and an id that is not G-0001 is no goal', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const g = await ws.createGoal({ ...goal(1), nonGoals: ['Billing'], limits: { usd: 5, builds: 4 } });
    expect(g).toMatchObject({ id: 'G-0001', nonGoals: ['Billing'], limits: { usd: 5, builds: 4 } });
    // twenty appends at once all land: each edit reads the goal the one before it wrote
    await Promise.all(Array.from({ length: 20 }, (_, i) => ws.updateGoal(g.id, (now) => ({ decisions: [...now.decisions, { id: `D${i + 1}`, text: `Decision ${i + 1}`, by: 'you', at: new Date().toISOString() }] }))));
    expect((await ws.readGoal(g.id)).decisions).toHaveLength(20);
    await expect(ws.updateGoal(g.id, () => ({ status: 'finished' as never }))).rejects.toBeInstanceOf(StoreError);
    expect((await ws.readGoal(g.id)).status).toBe('draft');
    await expect(ws.readGoal('../config')).rejects.toMatchObject({ code: 'not_found' });
    await expect(ws.readGoal('G-0009')).rejects.toMatchObject({ code: 'not_found' });
    await expect(ws.createGoal({ ...goal(2), criteria: [] })).rejects.toMatchObject({ code: 'invalid' });
  });
}, 60_000);
