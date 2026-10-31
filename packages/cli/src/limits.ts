import { LIMIT_NAMES, type LimitName, type Limits, type TaskLimits, type TaskUsage } from '@stint-dev/core';
import { defineCommand } from 'citty';
import { getDaemon, postDaemon } from './client';
import { repoRoot } from './repo';

/** The flag for each limit, as `stint new` and `stint limits` take it, and the words a meter uses. */
const FLAGS: Record<LimitName, { flag: string; word: string; int: boolean }> = {
  builds: { flag: 'max-builds', word: 'Builds', int: true },
  handoffs: { flag: 'max-handoffs', word: 'Hand-offs', int: true },
  reviewRounds: { flag: 'max-review-rounds', word: 'Review rounds', int: true },
  usd: { flag: 'max-usd', word: 'Spend', int: false },
  minutes: { flag: 'max-minutes', word: 'Agent time', int: true },
};

export const limitArgs = {
  'max-builds': { type: 'string', description: 'Builds autopilot may start before it stops and asks (default 8)' },
  'max-handoffs': { type: 'string', description: 'Hand-offs to another agent before it stops and asks (default 3)' },
  'max-review-rounds': { type: 'string', description: 'Builds asked for by a review before it stops and asks (default 1)' },
  'max-usd': { type: 'string', description: 'Dollars the task may spend before it stops and asks (default: no limit)' },
  'max-minutes': { type: 'string', description: 'Minutes of agent time before it stops and asks (default: no limit)' },
} as const;

/** The limits the flags set; a value that is not a number exits 2 with the flag named. The daemon checks the ranges. */
export function limitsFromFlags(args: Record<string, unknown>, none: string[] = []): TaskLimits {
  const out: TaskLimits = {};
  for (const k of LIMIT_NAMES) {
    const raw = args[FLAGS[k].flag];
    if (typeof raw !== 'string') continue;
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || (FLAGS[k].int && !Number.isInteger(n))) {
      process.stderr.write(`--${FLAGS[k].flag} must be ${FLAGS[k].int ? 'a whole number' : 'a number of dollars'}, not ${raw}\n`);
      process.exit(2);
    }
    out[k] = n;
  }
  for (const name of none) {
    const k = LIMIT_NAMES.find((l) => l === name || FLAGS[l].flag === `max-${name}`);
    if (!k) {
      process.stderr.write(`--none takes builds, handoffs, review-rounds, usd or minutes, not ${name}\n`);
      process.exit(2);
    }
    out[k] = null;
  }
  return out;
}

const money = (v: number) => `$${v.toFixed(2)}`;

/** One line per limit: what the task has used and its cap, or the used value alone when there is no cap. */
export function meterLines(limits: Limits, used: TaskUsage): string[] {
  return LIMIT_NAMES.map((k) => {
    const cap = limits[k];
    const show = (v: number) => (k === 'usd' ? money(v) : String(Math.round(v)));
    const unit = k === 'minutes' ? ' min' : '';
    const value = cap === null ? `${show(used[k])}${unit}, no limit` : `${show(used[k])} of ${show(cap)}${unit}`;
    return `${FLAGS[k].word.padEnd(14)}${value}${k === 'usd' && used.unpriced ? `, ${used.unpriced} not priced` : ''}`;
  });
}

type Meters = { limits: Limits; used: TaskUsage; own: TaskLimits; tokens: { budget: number; spent: number } };

/** The token budgets a person raises where a run was refused over one, each as `--<role>-tokens`. */
const BUDGET_ROLES = ['implementer', 'planner', 'reviewer', 'tester', 'learn'] as const;
const budgetArgs = Object.fromEntries(
  BUDGET_ROLES.map((r) => [`${r}-tokens`, { type: 'string', description: `Tokens the ${r} runs of this task may use, uncached input plus output` }]),
) as Record<`${(typeof BUDGET_ROLES)[number]}-tokens`, { type: 'string'; description: string }>;

function budgetsFromFlags(args: Record<string, unknown>): Partial<Record<(typeof BUDGET_ROLES)[number], number>> | undefined {
  const out: Partial<Record<(typeof BUDGET_ROLES)[number], number>> = {};
  for (const r of BUDGET_ROLES) {
    const raw = args[`${r}-tokens`];
    if (typeof raw !== 'string') continue;
    const n = Number(raw.replaceAll(',', ''));
    if (!Number.isInteger(n) || n < 0) {
      process.stderr.write(`--${r}-tokens must be a whole number of tokens, not ${raw}\n`);
      process.exit(2);
    }
    out[r] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

export const limits = defineCommand({
  meta: { name: 'limits', description: "Show a task's limits and what it has used, or change them" },
  args: {
    task: { type: 'positional', required: true, description: 'Task id' },
    ...limitArgs,
    ...budgetArgs,
    none: { type: 'string', description: 'Take a limit off: builds, handoffs, review-rounds, usd or minutes (several with commas)' },
    json: { type: 'boolean', description: 'Machine-readable output' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const budgets = budgetsFromFlags(args);
    const change = { ...limitsFromFlags(args, args.none ? args.none.split(',').map((s) => s.trim()).filter(Boolean) : []), ...(budgets ? { budgets } : {}) };
    const path = `/api/tasks/${args.task}/limits`;
    const m = Object.keys(change).length ? await postDaemon<Meters>(root, path, change, 'PATCH') : await getDaemon<Meters>(root, path);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(m)}\n`);
      return;
    }
    process.stdout.write(`${[...meterLines(m.limits, m.used), `${'Tokens'.padEnd(14)}${m.tokens.spent} of ${m.tokens.budget}, implementer`].join('\n')}\n`);
    // raising a limit does not restart autopilot; switching it on again does
    if (Object.keys(change).length) process.stdout.write(`Limits changed. If autopilot stopped at a limit, switch it on again: stint run ${args.task}\n`);
  },
});
