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

const ask = (text: string, extra: Record<string, unknown> = {}) => ({
  text,
  changes: 'implementation',
  evidence: 'The goal and test/webhooks.test.ts disagree on this.',
  options: [
    { label: 'The first way', consequence: 'Fewer files change.' },
    { label: 'The second way', consequence: 'More tests change.' },
  ],
  recommendation: { option: 'The first way', why: 'It is what the goal says.' },
  safeDefault: { exists: true, option: 'The first way', why: 'Cheap to change later.' },
  blocks: [1],
  material: false,
  ...extra,
});

/** A sharpen round of six questions: one the repository can answer, one material by its scope, four with a safe default. */
export const QUESTIONS = {
  version: 'stint.questions/1',
  questions: [
    ask('Should a tenant over the limit get 429 or 503 back?'),
    ask('Do retries of a failed webhook count towards the limit?', {
      changes: 'scope',
      options: [
        { label: 'Retries count', consequence: 'A tenant with failures hits the limit sooner.' },
        { label: 'Retries do not count', consequence: 'The limiter must know which requests are retries.' },
      ],
      recommendation: { option: 'Retries do not count', why: 'A retry is the same webhook.' },
      safeDefault: { exists: false },
    }),
    ask('Which file holds the limiter?'),
    ask('Is the window sliding or fixed for each tenant?'),
    ask('Are the counters kept in memory or in Redis?'),
    ask('Is the limit counted per tenant or per sender key?'),
  ],
  assumed: [{ text: 'The window is 60 seconds.', why: 'The goal names no length.' }],
  proofs: [{ criterion: 1, kind: 'test', ref: '429 with Retry-After', why: 'A test can read the status and the header.' }],
};

/** Plays the planner, the reviewer and sharpen: answers by the schema it is asked for, and keeps each prompt. */
export function fakeModels() {
  const asked: string[] = [];
  const prompts: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      if (url.pathname === '/api/chat') {
        const body = JSON.stringify((await req.json()) as unknown);
        // the pick among green candidates names the first one it was shown
        const pick = body.includes('Pick the one a careful reviewer would merge') ? { pick: /### (T-\d+)/.exec(body)?.[1], reason: 'The first is as simple as the rest.' } : null;
        const questions = body.includes('stint.questions/1');
        const review = body.includes('"verdict"');
        asked.push(pick ? 'pick' : questions ? 'sharpen' : review ? 'review' : 'plan');
        prompts.push(body);
        return Response.json({ message: { content: JSON.stringify(pick ?? (questions ? QUESTIONS : review ? APPROVE : PLAN)) }, prompt_eval_count: 100, eval_count: 20 });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, asked, prompts, stop: () => server.stop(true) };
}

export async function setup(repo: string, adapters: Adapter[], models: { url: string }, autopilot?: Config['autopilot'], sharpen?: Config['sharpen']) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: models.url, models: { fake: 'fake' } };
  config.routes.planner = ['ollama/fake'];
  config.routes.reviewer = ['ollama/fake'];
  config.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
  if (autopilot) config.autopilot = autopilot;
  if (sharpen) config.sharpen = sharpen;
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
