// Scheduled upkeep (R-044): agent-written code drifts, so the factory tends to itself through the same queue as
// everything else. Each template becomes a task on its schedule, goes through autopilot and stops at your
// approval like any other task. One open task per template at a time.
import { join } from 'node:path';
import { readJsonIfExists, writeJsonAtomic } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import type { DaemonContext } from './app';

export type Template = { id: string; title: string; goal: string; acceptance: string[] };

/** The two upkeep jobs every workspace gets once gardening is on, beside the person's own. */
export const BUILT_INS: Template[] = [
  {
    id: 'docs',
    title: 'Doc gardening: bring the docs back in line with the code',
    goal: 'Read README.md, AGENTS.md and docs/ against the code. Fix stale commands, dead links, flags and options that no longer exist, and examples that no longer run. Change the docs only; where the code looks wrong instead, say so as an open item in the packet.',
    acceptance: ['Every command in README.md and docs/ exists and runs as written', 'No dead relative links in the docs', 'No code changes'],
  },
  {
    id: 'drift',
    title: 'Dead code and dependency drift: remove what is dead, propose the rest',
    goal: 'Find unused exports, unused files and unused dependencies, and dependencies more than one major version behind. Remove what is clearly dead with the tests and typecheck still green. For upgrades, write the proposal in the packet; do not upgrade.',
    acceptance: ['The tests and typecheck stay green', 'Each removal is listed with why it is dead', 'Upgrades are proposed in the packet, not made'],
  },
];

const DAY = 86_400_000;
const EVERY: Record<string, number> = { daily: DAY, weekly: 7 * DAY };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';

export function templates(ctx: DaemonContext): Template[] {
  const own = (ctx.ws.config.gardening?.tasks ?? []).map((t) => ({ id: `own-${slug(t.title)}`, title: t.title, goal: t.goal, acceptance: [t.goal.slice(0, 300)] }));
  return [...BUILT_INS, ...own];
}

const statePath = (ctx: DaemonContext) => join(ctx.ws.cacheDir, 'gardening.json');

type State = Record<string, string>;

/** Each template with when it last made a task, when it is next due, and its open task if any. */
export async function gardenStatus(ctx: DaemonContext, now = new Date()) {
  const schedule = ctx.ws.config.gardening?.schedule ?? 'off';
  const state = (await readJsonIfExists<State>(statePath(ctx))) ?? {};
  const open = new Map<string, string>();
  for (const t of await ctx.ws.listTasks()) {
    if (t.source?.kind === 'gardening' && !['done', 'rejected', 'abandoned'].includes(t.status)) open.set(t.source.ref, t.id);
  }
  return {
    schedule,
    templates: templates(ctx).map((t) => {
      const lastAt = state[t.id] ?? null;
      const nextAt = schedule === 'off' ? null : lastAt ? new Date(Date.parse(lastAt) + (EVERY[schedule] as number)).toISOString() : now.toISOString();
      return { id: t.id, title: t.title, lastAt, nextAt, openTask: open.get(t.id) ?? null };
    }),
  };
}

/**
 * One pass of the scheduler: every template that is due and has no open task becomes a task on autopilot.
 * Pure apart from its writes, with the clock passed in, so a test can move time forward.
 */
export async function gardenTick(ctx: DaemonContext, now = new Date()): Promise<string[]> {
  const status = await gardenStatus(ctx, now);
  if (status.schedule === 'off') return [];
  const state = (await readJsonIfExists<State>(statePath(ctx))) ?? {};
  const created: string[] = [];
  for (const s of status.templates) {
    if (s.openTask || (s.nextAt && Date.parse(s.nextAt) > now.getTime())) continue;
    const t = templates(ctx).find((x) => x.id === s.id) as Template;
    const task = await ctx.ws.createTask({ title: t.title.slice(0, 120), goal: t.goal, acceptance: t.acceptance, tags: ['gardening'] });
    await ctx.ws.writeTask(task.id, { source: { kind: 'gardening', ref: t.id } });
    state[t.id] = now.toISOString();
    await writeJsonAtomic(statePath(ctx), state);
    // upkeep goes through autopilot and stops at your approval, like any task
    await ctx.autopilot.start(task.id);
    created.push(task.id);
  }
  return created;
}

export function gardeningRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/gardening', async (c) => c.json(await gardenStatus(ctx)));
}
