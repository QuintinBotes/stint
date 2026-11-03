#!/usr/bin/env bun
// The review recheck: every scorecard attempt the hidden tests graded, red and green, reviewed again by each
// reviewer named, with the prompt, schema and inputs the daemon's reviewer gets (lensReview and modelRun in
// packages/daemon/src/routes/models.ts): the packet the review would have read, the change's unified diff, the
// decisions valid when the review ran, and the reviewer skills (none: the scorecard's clones have no
// .agents/skills). Writes bench/review-recheck/verdicts.json and each attempt's prompt.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildReviewPrompt, hostsFromConfig } from '../packages/adapters/openai-compatible/src/index';
import { DEFAULT_CONFIG, type Handoff, type Review, ReviewSchema, type ScorecardAttempt, countTokens, renderHandoff } from '../packages/core/src/index';
import { DecisionLedger } from '../packages/core/src/node';
import { walkChain } from '../packages/daemon/src/route';
import { scrubber } from './seeded-run';

// the published-record scrub the scorecard uses: local paths, the user name, keys, emails and dashes
const scrub = scrubber([]);

const ROOT = resolve(import.meta.dir, '..');
const SOURCES = [
  { id: 'scorecard', dir: join(ROOT, 'bench', 'scorecard') },
  { id: 'scorecard-1', dir: join(ROOT, 'bench', 'scorecard-1', 'attempts') },
];

type Patch = { source: string; attempt: string; hidden: 'green' | 'red'; recorded: { verdict: string; findings: number; model: string | null } | null; prompt: string; localPrompt: string; diffBytes: number };
type Verdict = {
  reviewer: string;
  verdict: Review['verdict'] | null;
  summary: string | null;
  findings: Array<{ severity: string; text: string; file?: string; line?: number }>;
  inputTokens: number;
  outputTokens: number;
  usd: number | null;
  wallMs: number;
  error?: string;
};

type Event = { type: string; run?: string; ts: string; payload: Record<string, unknown> };

/** One attempt's review inputs as the daemon would have built them when its review ran. */
export async function reviewInputs(taskDir: string, offline = false): Promise<{ prompt: string; at: string; diff: string }> {
  const events = readFileSync(join(taskDir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Event);
  const reviewStart = events.find((e) => e.type === 'run.started' && e.payload.role === 'reviewer');
  // no review ran when the attempt's own tests were red; the last packet then stands for what one would have read
  const before = reviewStart ? events.filter((e) => e.ts <= reviewStart.ts) : events;
  const packetName = before.filter((e) => e.type === 'handoff.created').at(-1)?.payload.name as string | undefined;
  const packet = packetName ? (JSON.parse(readFileSync(join(taskDir, 'handoffs', `${packetName}.json`), 'utf8')) as Handoff) : null;
  const task = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8')) as { id: string; goal: string; acceptance: string[] };
  const diff = existsSync(join(taskDir, 'diff.patch')) ? readFileSync(join(taskDir, 'diff.patch'), 'utf8') : '';
  const at = reviewStart?.ts ?? new Date().toISOString();
  const decisions = await new DecisionLedger(join(taskDir, 'decisions.md'), task.id).validAt(at);
  const prompt = buildReviewPrompt({
    packetPrompt: packet ? renderHandoff(packet) : `Task ${task.id}: ${task.goal}`,
    diff,
    decisions: decisions.map((d) => ({ id: d.id, text: d.text })),
    skills: [],
    acceptance: task.acceptance,
    offline,
  });
  return { prompt, at, diff };
}

async function collect(): Promise<Patch[]> {
  const out: Patch[] = [];
  for (const s of SOURCES) {
    if (!existsSync(s.dir)) continue;
    for (const name of readdirSync(s.dir).sort()) {
      const attemptFile = join(s.dir, name, 'attempt.json');
      if (!existsSync(attemptFile)) continue;
      const a = JSON.parse(readFileSync(attemptFile, 'utf8')) as ScorecardAttempt;
      // an attempt the hidden tests could not grade says nothing about a reviewer
      if (a.hidden !== 'green' && a.hidden !== 'red') continue;
      const inputs = await reviewInputs(join(s.dir, name, 'tasks', 'T-0001'));
      const local = await reviewInputs(join(s.dir, name, 'tasks', 'T-0001'), true);
      out.push({
        source: s.id,
        attempt: name,
        hidden: a.hidden,
        recorded: a.review ? { verdict: a.review.verdict, findings: a.review.findings.length, model: a.review.model } : null,
        prompt: inputs.prompt,
        localPrompt: local.prompt,
        diffBytes: Buffer.byteLength(inputs.diff),
      });
    }
  }
  return out;
}

/** One review on one chain entry, as modelRun calls it: the reviewer role's timeout and token budget, the review schema. */
async function review(entry: string, prompt: string): Promise<Verdict> {
  const jsonSchema = JSON.parse(readFileSync(join(ROOT, 'packages', 'core', 'schemas', 'review.schema.json'), 'utf8'));
  const started = Date.now();
  try {
    const r = await walkChain<{ value: Review }>({
      role: 'reviewer',
      chain: [entry],
      hosts: hostsFromConfig(DEFAULT_CONFIG) as never,
      call: (h, model, c) => (h as { complete: (...args: unknown[]) => Promise<{ value: Review }> }).complete(ReviewSchema, jsonSchema, prompt, { model, timeoutMs: c.timeoutMs, maxTokens: DEFAULT_CONFIG.budgets.reviewer, emit: c.emit }),
    });
    const value = ((r.value as { value?: Review }).value ?? r.value) as Review;
    return {
      reviewer: entry,
      verdict: value.verdict,
      summary: value.summary ?? null,
      findings: value.findings.map((f) => ({ severity: f.severity, text: f.text, ...(f.file ? { file: f.file } : {}), ...(f.line ? { line: f.line } : {}) })),
      inputTokens: r.cost.inputTokens,
      outputTokens: r.cost.outputTokens,
      usd: r.cost.usd,
      wallMs: Date.now() - started,
    };
  } catch (err) {
    const cost = (err as { cost?: { inputTokens?: number; outputTokens?: number; usd?: number | null } }).cost;
    return { reviewer: entry, verdict: null, summary: null, findings: [], inputTokens: cost?.inputTokens ?? 0, outputTokens: cost?.outputTokens ?? 0, usd: cost?.usd ?? null, wallMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Caught: flagged (not approve) with the hidden tests red. Wrongly blocked: flagged with them green. As the scorecard counts. */
export function table(rows: Array<{ hidden: 'green' | 'red'; verdict: string | null }>) {
  const answered = rows.filter((r) => r.verdict !== null);
  const flagged = (r: { verdict: string | null }) => r.verdict !== 'approve';
  const red = answered.filter((r) => r.hidden === 'red');
  const green = answered.filter((r) => r.hidden === 'green');
  return { caught: red.filter(flagged).length, red: red.length, wronglyBlocked: green.filter(flagged).length, green: green.length, unanswered: rows.length - answered.length };
}

if (import.meta.main) {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { reviewers: { type: 'string' }, out: { type: 'string' }, 'budget-usd': { type: 'string' } } });
  const reviewers = (values.reviewers ?? 'meta-api/muse-spark-1.3,ollama/muse-glimmer:30b-mlx').split(',');
  const out = resolve(values.out ?? join(ROOT, 'bench', 'review-recheck'));
  const budget = values['budget-usd'] === undefined ? null : Number(values['budget-usd']);
  if (process.env.STINT_LIVE !== '1') {
    process.stderr.write('review-recheck calls models; set STINT_LIVE=1 to run it\n');
    process.exit(2);
  }
  const patches = await collect();
  mkdirSync(out, { recursive: true });
  const results: Array<Omit<Patch, 'prompt' | 'localPrompt'> & { promptTokens: number; localPromptTokens: number; reviews: Verdict[] }> = [];
  let spent = 0;
  // before the first hosted review, the most one can cost: the reviewer budget all spent on output at $5 per million
  let largest = (DEFAULT_CONFIG.budgets.reviewer * 5) / 1_000_000;
  let observed = 0;
  for (const p of patches) {
    const dir = join(out, `${p.source}-${p.attempt}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prompt.md'), scrub(p.prompt));
    // a local reviewer reads more of the diff than a hosted one, as the daemon's does
    if (reviewers.some((e) => e.startsWith('ollama/'))) writeFileSync(join(dir, 'prompt-local.md'), scrub(p.localPrompt));
    const reviews: Verdict[] = [];
    for (const entry of reviewers) {
      if (budget !== null && !entry.startsWith('ollama/') && spent + largest > budget) {
        reviews.push({ reviewer: entry, verdict: null, summary: null, findings: [], inputTokens: 0, outputTokens: 0, usd: null, wallMs: 0, error: `not run: $${spent.toFixed(4)} spent plus the next review at up to $${largest.toFixed(4)} would pass the $${budget} budget` });
        continue;
      }
      const v = await review(entry, entry.startsWith('ollama/') ? p.localPrompt : p.prompt);
      spent += v.usd ?? 0;
      // after that, half again the largest hosted review so far
      if (!entry.startsWith('ollama/') && v.usd !== null) observed = Math.max(observed, v.usd);
      if (observed > 0) largest = observed * 1.5;
      reviews.push(v);
      process.stdout.write(`${p.source} ${p.attempt} hidden ${p.hidden}: ${entry} ${v.verdict ?? `no verdict (${v.error})`}, ${v.findings.length} findings, $${(v.usd ?? 0).toFixed(4)}\n`);
    }
    const { prompt: _p, localPrompt: _l, ...rest } = p;
    results.push({ ...rest, promptTokens: countTokens(p.prompt), localPromptTokens: countTokens(p.localPrompt), reviews });
    // each patch's verdicts land as they come, so a stopped run keeps what it paid for
    writeFileSync(join(dir, 'reviews.json'), scrub(`${JSON.stringify(results.at(-1), null, 2)}\n`));
  }
  const tables = Object.fromEntries([
    ['recorded glimmer', table(results.filter((r) => r.recorded).map((r) => ({ hidden: r.hidden, verdict: r.recorded?.verdict ?? null })))],
    ...reviewers.map((entry) => [entry, table(results.map((r) => ({ hidden: r.hidden, verdict: r.reviews.find((v) => v.reviewer === entry)?.verdict ?? null })))]),
  ]);
  const record = { version: 'stint.review-recheck/1', generatedAt: new Date().toISOString(), reviewers, spendUsd: Math.round(spent * 10_000) / 10_000, tables, patches: results };
  writeFileSync(join(out, 'verdicts.json'), scrub(`${JSON.stringify(record, null, 2)}\n`));
  process.stdout.write(`${JSON.stringify(tables, null, 2)}\nspend $${record.spendUsd.toFixed(4)}\n`);
}
