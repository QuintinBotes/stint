import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StintEvent, Task } from '@stint-dev/core';
import { Workspace, runsFromEvents } from '@stint-dev/core/node';
import { defineCommand } from 'citty';
import { repoRoot } from './repo';

/**
 * The Reviews and Spend tables PROGRESS.md keeps, from the workspace's own events (R-047): when Stint builds
 * Stint, its `.stint/` history is the record. A row names its task, so `--write` can replace its own rows
 * and leave the ones the loop wrote by hand.
 */

const SPEC = /\bR-\d{3}\b/;

export function specOf(task: Task): string {
  const tag = (task.tags ?? []).find((t) => SPEC.test(t));
  const spec = tag ?? SPEC.exec(task.title)?.[0];
  return spec ? `${spec} (${task.id})` : task.id;
}

const usd = (v: number | null | undefined) => (v === null || v === undefined ? 'unpriced' : `$${v.toFixed(v > 0 && v < 0.01 ? 4 : 2)}`);
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export type Report = { reviews: string[]; spend: string[] };

export function reportRows(tasks: Array<{ task: Task; events: StintEvent[] }>): Report {
  const reviews: string[] = [];
  const spend: string[] = [];
  for (const { task, events } of tasks) {
    const spec = specOf(task);
    let attempt = 0;
    for (const e of events) {
      if (e.type !== 'review.recorded') continue;
      attempt += 1;
      const r = (e.payload.review ?? {}) as { model?: string; findings?: unknown[] };
      const findings = Array.isArray(r.findings) ? r.findings.length : Number(e.payload.findings ?? 0);
      reviews.push(`| ${spec} | ${attempt} | ${String(e.payload.verdict ?? 'unknown').replace('_', ' ')} | ${r.model ?? e.adapter ?? 'reviewer'} | ${findings} | .stint/tasks/${task.id}/reviews/${e.run ?? 'latest'}.json |`);
    }
    for (const r of runsFromEvents(events)) {
      if (!r.endedAt) continue;
      const agent = r.adapter === 'openai-compatible' ? `${r.role}:${r.host ?? 'model'}/${r.model ?? ''}` : `${r.adapter}${r.model ? `/${r.model}` : ''}`;
      const wall = Math.max(0, Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000));
      const tokens = r.cost ? `${r.cost.inputTokens}/${r.cost.outputTokens}` : 'none';
      spend.push(`| ${when(r.startedAt)} | ${spec} | ${agent} ${r.run} | ${tokens} | ${usd(r.cost?.usd)}${r.cost?.estimated ? ' (estimated)' : ''} | ${wall}s |`);
    }
  }
  return { reviews, spend };
}

/** A row Stint wrote names a task in its spec cell (`T-0042` or `R-047 (T-0050)`); the loop's own rows do not. */
const ours = (line: string) => line.split('|').some((c) => /^\s*(T-\d+|R-\d{3} \(T-\d+\))\s*$/.test(c));

/** Replaces this report's rows in one table of PROGRESS.md and keeps every other row. */
export function writeTable(doc: string, heading: string, rows: string[]): string {
  const start = doc.indexOf(`\n${heading}`);
  if (start < 0) throw new Error(`PROGRESS.md has no "${heading}" section`);
  const next = doc.indexOf('\n## ', start + 1);
  const end = next < 0 ? doc.length : next;
  const lines = doc.slice(start, end).split('\n');
  const sep = lines.findIndex((l) => /^\|---/.test(l));
  if (sep < 0) throw new Error(`the "${heading}" section has no table`);
  const kept = lines.slice(sep + 1).filter((l) => l.startsWith('|') && !ours(l));
  const rest = lines.slice(sep + 1).filter((l) => !l.startsWith('|'));
  const body = [...lines.slice(0, sep + 1), ...kept, ...rows, ...rest];
  return doc.slice(0, start) + body.join('\n') + doc.slice(end);
}

/** Every task's rows, or with `specsOnly` only the tasks made from a spec: PROGRESS.md tracks specs, not demo tasks. */
export async function report(root: string, o: { specsOnly?: boolean } = {}): Promise<Report> {
  const ws = await Workspace.open(root);
  const tasks = [];
  for (const task of await ws.listTasks()) {
    if (o.specsOnly && specOf(task) === task.id) continue;
    tasks.push({ task, events: await ws.events(task.id).read() });
  }
  return reportRows(tasks);
}

export const reportCommand = defineCommand({
  meta: { name: 'report', description: "The Reviews and Spend tables from this workspace's events, as PROGRESS.md keeps them" },
  args: {
    write: { type: 'boolean', description: 'Update the tables in PROGRESS.md instead of printing them' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    if (!existsSync(join(root, '.stint'))) {
      process.stderr.write(`No .stint/ in ${root}. Run stint up or stint demo first.\n`);
      process.exit(1);
    }
    const r = await report(root, { specsOnly: !!args.write });
    if (args.write) {
      const path = join(root, 'PROGRESS.md');
      if (!existsSync(path)) {
        process.stderr.write(`No PROGRESS.md in ${root}.\n`);
        process.exit(1);
      }
      let doc = readFileSync(path, 'utf8');
      doc = writeTable(doc, '## Reviews', r.reviews);
      doc = writeTable(doc, '## Spend', r.spend);
      writeFileSync(path, doc);
      process.stdout.write(`PROGRESS.md: ${r.reviews.length} review rows, ${r.spend.length} spend rows from .stint/\n`);
      return;
    }
    process.stdout.write('## Reviews\n\n| Spec | Attempt | Verdict | Reviewer | Findings | File |\n|---|---|---|---|---|---|\n');
    process.stdout.write(r.reviews.map((l) => `${l}\n`).join(''));
    process.stdout.write('\n## Spend\n\n| When | Spec | Agent | Tokens in/out | USD | Wall |\n|---|---|---|---|---|---|\n');
    process.stdout.write(r.spend.map((l) => `${l}\n`).join(''));
  },
});
