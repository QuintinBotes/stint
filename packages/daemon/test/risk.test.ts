import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '@stint-dev/core';
import { daemonContext } from '../src/app';
import { afterReview } from '../src/risk';
import { fakeModels, setup, stopped, task, until } from './autopilot.fixtures';
import { fakeAdapter, post, withFixtureRepo } from './helpers';

const DAY = 86_400_000;
const lane = (enabled: boolean, shadowDays = 1): NonNullable<Config['risk']> => ({ highPaths: [], autoApprove: { enabled, tiers: ['low'], shadowDays } });

/** A small change through autopilot: plan, build, verify, an approving review, then the gate. */
async function reviewed(app: Parameters<typeof post>[0], ws: Awaited<ReturnType<typeof setup>>['ws'], title: string) {
  const t = await ws.createTask(task('true', title));
  await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
  await until(ws, t.id, stopped);
  return t;
}

/** Shadow decisions on other tasks, as earlier human approvals would have left them. */
async function shadow(ws: Awaited<ReturnType<typeof setup>>['ws'], rows: Array<{ would: boolean; human: 'approved' | 'rejected' }>): Promise<number> {
  let first = 0;
  for (const [i, r] of rows.entries()) {
    const t = await ws.createTask(task('true', `Earlier task ${i + 1}`));
    const e = await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'autoapprove.shadow', payload: { tier: 'low', wouldApprove: r.would, humanDecision: r.human, why: 'earlier' } });
    first ||= Date.parse(e.ts);
    await Bun.sleep(5);
  }
  return first;
}

test('A low-risk task is assessed low and shadow-recorded; with the lane off nothing is merged', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models);
      const t = await reviewed(app, ws, 'A small change');
      const events = await ws.events(t.id).read();
      expect(events.find((e) => e.type === 'risk.assessed')?.payload).toMatchObject({ tier: 'low' });
      expect((await ws.readTask(t.id)).risk).toBe('low');
      expect(events.some((e) => e.type === 'merge.completed' || e.type === 'autoapprove.granted')).toBe(false);
      expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');

      // the person approves; the record says the policy would have too
      expect((await post(app, `/api/tasks/${t.id}/approve`, {})).status).toBe(200);
      const after = await ws.events(t.id).read();
      expect(after.find((e) => e.type === 'autoapprove.shadow')?.payload).toMatchObject({ tier: 'low', wouldApprove: true, humanDecision: 'approved' });
      // the shadow lands before merge.completed, so a reader that follows the merge (the sign-off, the Factory) already sees it
      const seqOf = (type: string) => after.find((e) => e.type === type)?.seq ?? Number.POSITIVE_INFINITY;
      expect(seqOf('autoapprove.shadow')).toBeLessThan(seqOf('merge.completed'));
      expect(after.find((e) => e.type === 'approval.granted')?.payload.by).toBe('you');
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('With the lane on but a shadow disagreement in the window, nothing is merged; with a clean window it merges by policy', async () => {
  const models = fakeModels();
  try {
    // a disagreement in the window: the lane stays shut
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models);
      const first = await shadow(ws, [{ would: true, human: 'approved' }, { would: true, human: 'approved' }, { would: true, human: 'rejected' }]);
      ws.config.risk = lane(true);
      const t = await reviewed(app, ws, 'A small change');
      // one day after the first shadow decision: the record covers the window, and the disagreement is inside it
      const r = await afterReview(daemonContext(app), t.id, new Date(first + DAY));
      expect(r).toEqual({ approved: false, why: '1 shadow disagreement on low risk in the last 1 days' });
      expect((await ws.events(t.id).read()).some((e) => e.type === 'merge.completed')).toBe(false);
    });
    // a clean window: the policy approves through the same gate, and says so
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models);
      const first = await shadow(ws, [{ would: true, human: 'approved' }, { would: true, human: 'approved' }, { would: false, human: 'rejected' }]);
      ws.config.risk = lane(true);
      const t = await reviewed(app, ws, 'A small change');
      // today the record is too young, so the review did not merge it
      expect((await ws.events(t.id).read()).some((e) => e.type === 'merge.completed')).toBe(false);
      const r = await afterReview(daemonContext(app), t.id, new Date(first + DAY));
      expect(r.approved).toBe(true);
      const events = await ws.events(t.id).read();
      expect(events.find((e) => e.type === 'autoapprove.granted')?.payload).toMatchObject({ tier: 'low' });
      expect(events.find((e) => e.type === 'approval.granted')).toMatchObject({ vendor: 'daemon', payload: { by: 'policy' } });
      expect(events.some((e) => e.type === 'merge.completed')).toBe(true);
      expect((await ws.readTask(t.id)).status).toBe('done');
    });
  } finally {
    models.stop();
  }
}, 180_000);

test('The lane can be turned off from the Factory, and only off', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models);
      const path = join(repo, '.stint', 'config.json');
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Config;
      raw.risk = lane(true, 7);
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(path, JSON.stringify(raw));
      ws.config.risk = lane(true, 7);
      const before = (await (await app.request('/api/risk')).json()) as { lane: { enabled: boolean }; lanes: Array<{ tier: string; open: boolean; why: string }> };
      expect(before.lane.enabled).toBe(true);
      expect(before.lanes.find((l) => l.tier === 'low')?.why).toBe('0 shadow decisions on low risk, fewer than 3');
      expect((await post(app, '/api/risk/autoapprove', { enabled: true })).status).toBe(400);
      expect((await post(app, '/api/risk/autoapprove', { enabled: false })).status).toBe(200);
      expect(ws.config.risk?.autoApprove.enabled).toBe(false);
      expect((JSON.parse(readFileSync(path, 'utf8')) as Config).risk?.autoApprove.enabled).toBe(false);
    });
  } finally {
    models.stop();
  }
}, 60_000);
