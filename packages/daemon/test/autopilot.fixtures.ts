// The planner and reviewer as a fake model server, and the setup the autopilot tests share.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG, type StintEvent } from '@stint-dev/core';
import type { Workspace } from '@stint-dev/core/node';
import type { Adapter } from '../src/index';
import { makeApp } from './helpers';

export const PLAN = {
  version: 'stint.plan/1',
  steps: [{ id: 1, text: 'Add a per-tenant limiter', files: ['src/lib/limiter.ts'], test: 'test/limiter.test.ts' }],
  filesToTouch: ['src/lib/limiter.ts'],
  risks: [],
  decisions: [],
  similarTasks: [],
};
export const APPROVE = { version: 'stint.review/1', verdict: 'approve', summary: 'Looks right.', findings: [], blockers: [] };

/** Plays the planner and the reviewer: answers plan or review by the schema it is asked for. */
export function fakeModels() {
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      if (url.pathname === '/api/chat') {
        const review = JSON.stringify((await req.json()) as unknown).includes('"verdict"');
        asked.push(review ? 'review' : 'plan');
        return Response.json({ message: { content: JSON.stringify(review ? APPROVE : PLAN) }, prompt_eval_count: 100, eval_count: 20 });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, asked, stop: () => server.stop(true) };
}

export async function setup(repo: string, adapters: Adapter[], models: { url: string }, autopilot?: Config['autopilot']) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: models.url, models: { fake: 'fake' } };
  config.routes.planner = ['ollama/fake'];
  config.routes.reviewer = ['ollama/fake'];
  config.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
  if (autopilot) config.autopilot = autopilot;
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
  return makeApp(repo, adapters);
}

export const task = (testCommand: string, title = 'Rate-limit incoming webhooks') => ({ title, goal: 'Answer 429 when a tenant is over the limit.', acceptance: ['429 with Retry-After'], testCommand });

export async function until(ws: Workspace, id: string, done: (events: StintEvent[]) => boolean, ms = 60_000): Promise<StintEvent[]> {
  const end = Date.now() + ms;
  for (;;) {
    const events = await ws.events(id).read();
    if (done(events) || Date.now() > end) return events;
    await Bun.sleep(50);
  }
}
export const stopped = (events: StintEvent[]) => events.some((e) => e.type === 'autopilot.stopped');
export const steps = (events: StintEvent[]) => events.filter((e) => e.type === 'autopilot.step').map((e) => e.payload.step);
