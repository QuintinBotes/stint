// A planner that answers from a queue of plans and keeps every prompt it was sent.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { APPROVE } from './autopilot.fixtures';

export function planner(plans: unknown[]) {
  const prompts: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      if (url.pathname === '/api/chat') {
        const body = (await req.json()) as { messages: Array<{ content: string }> };
        const text = body.messages.map((m) => m.content).join('\n');
        const review = JSON.stringify(body).includes('"verdict"');
        if (!review) prompts.push(text);
        return Response.json({ message: { content: JSON.stringify(review ? APPROVE : (plans.shift() ?? plans.at(-1))) }, prompt_eval_count: 100, eval_count: 20 });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, prompts, stop: () => server.stop(true) };
}

export function writeConfig(repo: string, url: string, autopilot?: Config['autopilot']) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: url, models: { fake: 'fake' } };
  config.routes.planner = ['ollama/fake'];
  config.routes.reviewer = ['ollama/fake'];
  config.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
  if (autopilot) config.autopilot = autopilot;
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
}

export const plan = (extra: Record<string, unknown> = {}) => ({
  version: 'stint.plan/1',
  steps: [{ id: 1, text: 'Do it', files: ['src/lib/limiter.ts'] }],
  filesToTouch: ['src/lib/limiter.ts'],
  risks: [],
  similarTasks: [],
  ...extra,
});
