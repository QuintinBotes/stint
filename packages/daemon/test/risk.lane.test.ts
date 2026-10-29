import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { daemonContext } from '../src/app';
import { laneOpen } from '../src/risk';
import { builtTask, makeApp, post, withFixtureRepo } from './helpers';

const DAY = 86_400_000;

test('R-039 Req 3: a change the policy would have approved that was later reverted shuts the lane, which the same clean record opens', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const ctx = daemonContext(app);
    ws.config.risk = { highPaths: [], autoApprove: { enabled: true, tiers: ['low'], shadowDays: 1 } };
    const ids: string[] = [];
    let first = 0;
    for (let i = 1; i <= 3; i++) {
      const t = await ws.createTask({ title: `Earlier task ${i}`, goal: 'Change something.', acceptance: ['changed'], testCommand: 'true' });
      const e = await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'autoapprove.shadow', payload: { tier: 'low', wouldApprove: true, humanDecision: 'approved', why: 'earlier' } });
      first ||= Date.parse(e.ts);
      ids.push(t.id);
    }
    const now = new Date(first + DAY);
    expect(await laneOpen(ctx, 'low', now)).toEqual({ open: true, why: '3 shadow decisions on low risk over 1 days, all agreed, none reverted' });
    const reverted = ids[1] as string;
    await ws.events(reverted).append({ task: reverted, vendor: 'daemon', type: 'outcome.reverted', payload: { task: reverted, commit: 'abc1234', mergeCommit: 'def5678', revertedCommit: 'def5678', by: 'someone' } });
    expect(await laneOpen(ctx, 'low', now)).toEqual({ open: false, why: 'a change the policy would have approved was reverted in the last 1 days' });
  });
}, 60_000);

/** A reviewer per lens: the general lens approves, the security lens names one minor thing. */
function lensModels() {
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      const security = JSON.stringify(await req.json()).includes('## Lens: security');
      const findings = security ? [{ id: 'F1', severity: 'minor', text: 'The tenant id is logged with each 429.', file: 'src/lib/limiter.ts' }] : [];
      const review = { version: 'stint.review/1', verdict: security ? 'request_changes' : 'approve', summary: security ? 'See findings.' : 'No actionable findings.', findings, blockers: [] };
      return Response.json({ message: { content: JSON.stringify(review) }, prompt_eval_count: 100, eval_count: 20 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, stop: () => server.stop(true) };
}

test('R-039 Req 1: anything the security lens finds makes the change high risk, however small the diff', async () => {
  const models = lensModels();
  try {
    await withFixtureRepo(async (repo) => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: models.url, models: { fake: 'fake' } };
      config.routes.reviewer = ['ollama/fake'];
      config.review = { lenses: ['general', 'security'], bestOf: 1, crossVendor: true };
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      const { app, ws, t } = await builtTask(repo);
      expect((await post(app, `/api/tasks/${t.id}/review`, {})).status).toBe(200);
      expect((await ws.events(t.id).read()).findLast((e) => e.type === 'risk.assessed')?.payload).toEqual({ tier: 'high', reasons: ['the security review found 1 thing'] });
      expect((await ws.readTask(t.id)).risk).toBe('high');
    });
  } finally {
    models.stop();
  }
}, 60_000);
