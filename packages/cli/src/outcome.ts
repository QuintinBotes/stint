import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CRITERION_STATE_LABELS, type Outcome, durationWords } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { taskOutcome } from '@stint-dev/daemon';
import { defineCommand } from 'citty';
import { repoRoot } from './repo';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const money = (v: number) => `$${v.toFixed(v > 0 && v < 0.01 ? 4 : 2)}`;
/** "3 builds of 8", or "3 builds" when there is no limit. */
const against = (n: number, word: string, cap: number | null | undefined) => `${plural(n, word)}${cap === null || cap === undefined ? '' : ` of ${cap}`}`;

/** The outcome in lines: the result, one per criterion with its evidence, then loops, spend, times, review and after merge (R-063). */
export function outcomeLines(o: Outcome): string[] {
  const lines = [`${o.task}: ${o.resultLabel}`];
  for (const c of o.criteria) {
    lines.push(`  ${c.index + 1}. ${CRITERION_STATE_LABELS[c.state]}: ${c.text}`, `     ${c.evidence}`);
  }
  const l = o.limits;
  lines.push(`Loops: ${against(o.loops.builds, 'build', l?.builds)}, ${against(o.loops.handoffs, 'hand-off', l?.handoffs)}, ${against(o.loops.reviewRounds, 'review round', l?.reviewRounds)}`);
  const usdCap = l?.usd === null || l?.usd === undefined ? '' : ` of ${money(l.usd)}`;
  lines.push(`Spend: ${money(o.spend.usd)}${usdCap}${o.spend.unpriced ? `, plus ${plural(o.spend.unpriced, 'unpriced call')}` : ''}; agent time ${durationWords(o.minutes * 60_000)}${l?.minutes ? ` of ${l.minutes} min` : ''}`);
  const times = [
    o.timeToFirstGreen === undefined ? 'not green yet' : `green after ${durationWords(o.timeToFirstGreen)}`,
    ...(o.timeToApprovalRequest === undefined ? [] : [`approval asked after ${durationWords(o.timeToApprovalRequest)}`]),
    ...(o.approvalWait === undefined ? [] : [`you answered in ${durationWords(o.approvalWait)}`]),
    ...(o.leadTime === undefined ? [] : [`merged after ${durationWords(o.leadTime)}`]),
  ];
  lines.push(`Times: ${times.join(', ')}`);
  const f = o.review.findings;
  const severities = Object.entries(f.bySeverity).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`);
  lines.push(`Review: ${plural(o.review.rounds, 'round')}${o.review.verdicts.length ? ` (${o.review.verdicts.map((v) => v.replace('_', ' ')).join(', ')})` : ''}, ${plural(f.total, 'finding')}${severities.length ? ` (${severities.join(', ')})` : ''}`);
  const m = o.afterMerge;
  if (!m) {
    lines.push(o.result === 'merged' ? 'After merge: no merge is recorded in the log, so nothing is watched' : 'After merge: not merged yet');
    return lines;
  }
  lines.push(
    `After merge, within ${plural(m.window.days, 'day')}:`,
    `  Reverted: ${m.reverted ? 'yes' : 'no'}`,
    `  Follow-ups: ${m.followups.length ? m.followups.join(', ') : 'none'}`,
    `  CI: ${m.ci ? `failed (${m.ci.status}${m.ci.run ? `, run ${m.ci.run}` : ''})` : 'no failure recorded'}`,
    `  Incidents: ${m.incidents.length ? m.incidents.join('; ') : 'none'}`,
  );
  if (!m.window.mature) lines.push(`  Watching for reverts and follow-ups until ${m.window.endsAt.slice(0, 10)}.`);
  return lines;
}

export const outcomeCommand = defineCommand({
  meta: { name: 'outcome', description: 'How a task went: each criterion and its proof, loops against limits, spend, times, the review and after merge' },
  args: {
    task: { type: 'positional', description: 'Task id, such as T-0042', required: true },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    json: { type: 'boolean', description: 'Machine-readable output (stint.outcome/1)' },
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    if (!existsSync(join(root, '.stint'))) {
      process.stderr.write(`No .stint/ in ${root}. Run stint up or stint demo first.\n`);
      process.exit(1);
    }
    const o = await taskOutcome(await Workspace.open(root), String(args.task)).catch((e: unknown) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    });
    process.stdout.write(args.json ? `${JSON.stringify(o)}\n` : `${outcomeLines(o).join('\n')}\n`);
  },
});
