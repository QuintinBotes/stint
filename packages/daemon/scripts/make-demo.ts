// Writes demo/recording.jsonl (the hand-written replay of the beat sheet in AGENTS.md section 2) and the three
// example packets in packages/core/schemas/examples. The git effects are the real patches in demo/story, applied
// on a clone of the fixture with fixed identity and dates, so every commit id and packet hash in the recording is
// what the replay reproduces. R-022 replaces the recording with one captured from a live run.
//
// Run: bun run --cwd packages/daemon make:demo
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Cost,
  GENESIS,
  type Handoff,
  HandoffSchema,
  type Plan,
  type Review,
  type SkillProposal,
  countTokens,
  eventHash,
  hashHandoff,
  priceUsage,
  renderHandoff,
  DEFAULT_CONFIG,
} from '@stint-dev/core/node';
import { monotonicFactory } from 'ulid';
import { type ApplyStep, type RecordingHeader, type RecordingLine, applyGitStep, parseClock } from '../src/replay';

const ROOT = join(import.meta.dir, '..', '..', '..');
const STORY = join(ROOT, 'demo', 'story');
const RECORDED_AT = '2026-10-26T15:00:00Z';
const T0 = Date.parse(RECORDED_AT);
const ulid = monotonicFactory(() => 0.5);
const at = (clock: string) => parseClock(clock);
const iso = (ms: number) => new Date(T0 + ms).toISOString().replace('.000Z', 'Z');

// ---- the fixture, replayed for real to learn the commit ids ---------------------------------------------
const repo = mkdtempSync(join(tmpdir(), 'stint-make-demo-'));
const clone = Bun.spawnSync(['git', 'clone', '-q', join(ROOT, 'demo', 'repo.bundle'), repo]);
if (clone.exitCode !== 0) throw new Error('cannot clone the fixture');
const BASE = Bun.spawnSync(['git', '-C', repo, 'rev-parse', 'HEAD']).stdout.toString().trim();

async function commitStep(clock: string, branch: string, file: string, message: string): Promise<ApplyStep & { sha: string }> {
  const step: ApplyStep = { kind: 'commit', branch, patch: readFileSync(join(STORY, file), 'utf8'), message, date: iso(at(clock)) };
  return { ...step, sha: await applyGitStep(repo, step) };
}

// ---- prices and costs --------------------------------------------------------------------------------------
const P = DEFAULT_CONFIG.prices;
const cost = (key: string, inputTokens: number, cachedTokens: number, outputTokens: number): Cost => ({
  inputTokens,
  cachedTokens,
  outputTokens,
  usd: priceUsage(P[key], { inputTokens, cachedTokens, outputTokens }),
});
const COST = {
  t42r1: cost('meta-api/muse-wonder-1.0', 6120, 0, 1180),
  t42r2: cost('meta-api/muse-spark-1.3', 612400, 548200, 9840),
  t42r3: cost('meta-api/muse-spark-1.3', 920000, 820000, 20500),
  t42r4: cost('ollama/muse-glimmer:30b-mlx', 3420, 0, 610),
  learn: cost('baseten/muse-spark-open', 9800, 0, 640),
  t43r1: cost('meta-api/muse-spark-1.3', 401200, 362900, 6100),
  t43r2: cost('ollama/muse-glimmer:30b-mlx', 2980, 0, 140),
};
const t42Total = [COST.t42r1, COST.t42r2, COST.t42r3, COST.t42r4].reduce((s, c) => s + (c.usd ?? 0), 0);
if (t42Total.toFixed(2) !== '0.61') throw new Error(`T-0042 must total $0.61, got ${t42Total}`);

// ---- tasks -------------------------------------------------------------------------------------------------
const TASKS: RecordingHeader['tasks'] = [
  {
    id: 'T-0040',
    title: 'Add tenant header to audit log',
    goal: 'Every audit CSV row carries the tenant, and GET /audit filters by the X-Tenant header.',
    acceptance: ['The CSV has a tenant column', 'GET /audit filters by X-Tenant'],
    testCommand: 'bun run test',
    status: 'done',
    tags: ['audit'],
  },
  {
    id: 'T-0042',
    title: 'Rate-limit incoming webhooks per tenant',
    goal: 'POST /webhooks answers 429 with a Retry-After header when a tenant sends too many webhooks in a window, without affecting other tenants.',
    acceptance: ['A tenant over the limit gets 429 with a Retry-After header', 'Other tenants are not affected', 'The suite stays green'],
    testCommand: 'bun run test',
    tags: ['webhooks', 'limits'],
  },
  {
    id: 'T-0043',
    title: 'Rate-limit the admin API',
    goal: 'The admin routes answer 429 with Retry-After over a limit, so a runaway script cannot flood tenant creation.',
    acceptance: ['The admin API answers 429 with Retry-After over the limit', 'The suite stays green'],
    testCommand: 'bun run test',
    tags: ['admin', 'limits'],
  },
];

const PLAN_T42: Plan = {
  version: 'stint.plan/1',
  steps: [
    { id: 1, text: 'Add a per-tenant sliding window limiter', files: ['src/lib/limiter.ts'], test: 'test/limiter.test.ts' },
    { id: 2, text: 'Check the limiter in POST /webhooks before reading the body; answer 429 with Retry-After', files: ['src/routes/webhooks.ts', 'src/app.ts'] },
    { id: 3, text: 'Test the 429 response, Retry-After and that other tenants are unaffected', files: ['test/ratelimit.test.ts'], test: 'test/ratelimit.test.ts' },
  ],
  filesToTouch: ['src/lib/limiter.ts', 'src/routes/webhooks.ts', 'src/app.ts', 'test/limiter.test.ts', 'test/ratelimit.test.ts'],
  risks: [
    { id: 'R1', text: 'Limiter state is in memory and resets on restart' },
    { id: 'R2', text: 'A constant limit cannot be tuned per deployment' },
  ],
  decisions: [
    { text: 'Count requests per tenant, not per source IP', why: 'the tenant is the unit of fairness in this service' },
    { text: 'Answer 429 with a Retry-After header, never 503', why: 'clients already retry on 429 with backoff' },
  ],
  similarTasks: ['T-0040'],
  model: 'meta-api/muse-wonder-1.0',
  offline: false,
  createdAt: iso(at('0:36')),
};

// ---- the event lines -------------------------------------------------------------------------------------
type Ctx = { run?: string; adapter?: string; vendor?: RecordingLine['vendor'] };
const lines: RecordingLine[] = [];
const seqs = new Map<string, { seq: number; hash: string }>();
let callN = 0;

function emit(clock: string, task: string, type: string, payload: Record<string, unknown>, c: Ctx = {}, extra: Partial<Pick<RecordingLine, 'beat' | 'apply' | 'links' | 'pause'>> = {}) {
  const ms = at(clock);
  const prev = seqs.get(task) ?? { seq: 0, hash: GENESIS };
  const base = { id: ulid(T0 + ms), seq: prev.seq + 1, ts: iso(ms), task, ...c, type: type as RecordingLine['type'], payload };
  const hash = eventHash(base, prev.hash);
  seqs.set(task, { seq: base.seq, hash });
  const { apply, ...rest } = extra;
  lines.push({ ...base, prev: prev.hash, hash, at: ms, ...rest, ...(apply ? { apply } : {}) });
}

const tool = (clock: string, clockResult: string, task: string, c: Ctx, name: string, args: Record<string, unknown>, summary: string) => {
  const callId = `call_${String(++callN).padStart(3, '0')}`;
  emit(clock, task, 'agent.tool_call', { tool: name, args, callId }, c);
  emit(clockResult, task, 'agent.tool_result', { tool: name, callId, ok: true, summary }, c);
};
const say = (clock: string, task: string, c: Ctx, text: string) => emit(clock, task, 'agent.message', { text }, c);
const changed = (clock: string, task: string, c: Ctx, path: string, added: number, removed: number) =>
  emit(clock, task, 'file.changed', { path, added, removed, run: c.run }, { ...c, adapter: undefined, vendor: 'daemon' }, { links: [{ kind: 'file', ref: path }] });

// T-0040: the seeded past task, done last week in the story.
emit('0:00', 'T-0040', 'task.created', { title: TASKS[0]?.title, goal: TASKS[0]?.goal, acceptance: TASKS[0]?.acceptance, testCommand: 'bun run test', seeded: true }, { vendor: 'daemon' }, { beat: 'The folder is the task' });
const REVIEW_T40: Review = {
  version: 'stint.review/1',
  verdict: 'approve',
  summary: 'The tenant column is right; two minor findings.',
  findings: [
    { id: 'F1', severity: 'minor', file: 'src/lib/backoff.ts', line: 4, text: 'The replay backoff has no jitter, so retries from many tenants line up.' },
    { id: 'F2', severity: 'minor', file: 'src/lib/audit.ts', line: 8, text: 'The export limit of 5000 rows is hard-coded; read it through loadConfig() like the other limits.' },
  ],
  blockers: [],
  model: 'ollama/muse-glimmer:30b-mlx',
  offline: true,
  cost: { inputTokens: 2810, cachedTokens: 0, outputTokens: 330, usd: 0 },
  run: 'r3',
};
emit('0:00.4', 'T-0040', 'review.recorded', { verdict: 'approve', findings: 2, contradictions: 0, offline: true, review: REVIEW_T40, seeded: true }, { run: 'r3', adapter: 'openai-compatible', vendor: 'meta' });

emit('0:01', 'T-0043', 'task.created', { title: TASKS[2]?.title, goal: TASKS[2]?.goal, acceptance: TASKS[2]?.acceptance, testCommand: 'bun run test' }, { vendor: 'daemon' });

// T-0042, 0:12: spoken, then planned by Muse Wonder.
const T = 'T-0042';
emit('0:12', T, 'task.created', { title: TASKS[1]?.title, goal: TASKS[1]?.goal, acceptance: TASKS[1]?.acceptance, testCommand: 'bun run test', source: 'voice', transcript: 'Rate-limit incoming webhooks per tenant. Over the limit, answer 429 with Retry-After, and do not slow down the other tenants.' }, { vendor: 'human' }, { beat: 'Speak the task; Wonder plans' });
const r1: Ctx = { run: 'r1', adapter: 'openai-compatible', vendor: 'meta' };
emit('0:13', T, 'run.started', { role: 'planner', model: 'muse-wonder-1.0', host: 'meta-api', similarTasks: ['T-0040'] }, r1);
say('0:15', T, r1, 'Reading the webhook route, the app factory and the config module.');
say('0:18', T, r1, 'Similar past task: T-0040 changed the audit export. Same conventions: tenant from X-Tenant, JSON errors, logic in src/lib.');
say('0:20', T, r1, 'decisions.md has nothing for T-0042 yet; AGENTS.md says every tunable number belongs in src/config.ts.');
say('0:22', T, r1, 'Step 1: a per-tenant sliding window limiter in src/lib/limiter.ts with unit tests.');
say('0:26', T, r1, 'Step 2: check the limiter in POST /webhooks before the body is read, and answer 429 with Retry-After.');
say('0:30', T, r1, 'Step 3: tests for the 429 response and for tenant isolation.');
say('0:31.5', T, r1, 'Files to touch: src/lib/limiter.ts, src/routes/webhooks.ts, src/app.ts and two test files.');
emit('0:33', T, 'decision.recorded', { id: 'D1', text: 'Count requests per tenant, not per source IP', by: 'openai-compatible r1' }, r1, { links: [{ kind: 'decision', ref: 'D1' }] });
emit('0:34', T, 'decision.recorded', { id: 'D2', text: 'Answer 429 with a Retry-After header, never 503', by: 'openai-compatible r1' }, r1, { links: [{ kind: 'decision', ref: 'D2' }] });
emit('0:36', T, 'run.finished', { endedBy: 'completed', cost: COST.t42r1, host: 'meta-api', plan: PLAN_T42 }, r1);
emit('0:37', T, 'task.status', { from: 'planned', to: 'building' }, { vendor: 'daemon' });

// 0:40, Muse Code builds in its worktree.
const r2: Ctx = { run: 'r2', adapter: 'muse-code', vendor: 'meta' };
emit('0:40', T, 'run.started', { role: 'implementer', model: 'muse-spark-1.3', host: 'local-cli', worktree: '.stint/worktrees/T-0042-r2', skills: ['review-voice-policy'] }, r2, { beat: 'Muse Code builds' });
emit('0:40.4', T, 'skill.applied', { skill: 'review-voice-policy', run: 'r2' }, { ...r2, adapter: undefined, vendor: 'daemon' }, { links: [{ kind: 'skill', ref: 'review-voice-policy' }] });
say('0:41', T, r2, 'Starting with the plan. Reading the route and the app factory first.');
tool('0:41.1', '0:41.3', T, r2, 'list_dir', { path: '.' }, 'AGENTS.md, README.md, package.json, src/, test/');
tool('0:41.5', '0:41.8', T, r2, 'list_dir', { path: 'src' }, 'app.ts, config.ts, lib/, routes/, server.ts');
tool('0:42.1', '0:42.3', T, r2, 'read_file', { path: 'src/routes/webhooks.ts' }, '33 lines');
tool('0:42.8', '0:43.0', T, r2, 'read_file', { path: 'src/app.ts' }, '39 lines');
tool('0:43.4', '0:43.6', T, r2, 'read_file', { path: 'src/config.ts' }, '23 lines');
tool('0:44.0', '0:44.2', T, r2, 'read_file', { path: 'test/helpers.ts' }, '17 lines');
tool('0:44.6', '0:44.9', T, r2, 'read_file', { path: 'AGENTS.md' }, '31 lines');
tool('0:45.3', '0:45.6', T, r2, 'grep', { pattern: 'X-Tenant', path: 'src' }, '5 matches in 3 files');
tool('0:45.7', '0:45.9', T, r2, 'read_file', { path: 'src/lib/store.ts' }, '48 lines');
say('0:46', T, r2, 'The tenant check happens before the body is read, so the limiter goes right after it.');
tool('0:46.4', '0:46.7', T, r2, 'grep', { pattern: 'limit', path: 'src' }, 'no limiter yet; replayMaxAttempts in src/config.ts');
say('0:47.5', T, r2, 'A fixed window would let a tenant send twice the limit across a window edge. Keeping a log of hit times per tenant avoids that.');
say('0:49', T, r2, 'decision: Sliding window over fixed window, so a burst at a window edge cannot double the limit');
emit('0:49.6', T, 'decision.recorded', { id: 'D3', text: 'Sliding window over fixed window, so a burst at a window edge cannot double the limit', by: 'muse-code r2' }, r2, { links: [{ kind: 'decision', ref: 'D3' }] });
tool('0:50.2', '0:50.6', T, r2, 'write_file', { path: 'src/lib/limiter.ts' }, 'wrote 18 lines');
changed('0:50.9', T, r2, 'src/lib/limiter.ts', 18, 0);
say('0:51.1', T, r2, 'Adding retryAfterMs so the route can set Retry-After from the oldest hit in the window.');
tool('0:51.3', '0:51.6', T, r2, 'edit_file', { path: 'src/lib/limiter.ts', summary: 'LimitResult with retryAfterMs' }, '8 lines added');
changed('0:51.8', T, r2, 'src/lib/limiter.ts', 26, 0);
tool('0:52.0', '0:52.3', T, r2, 'read_file', { path: 'src/lib/limiter.ts' }, '26 lines');
tool('0:52.9', '0:53.2', T, r2, 'edit_file', { path: 'src/app.ts', summary: 'add limiter to Deps and createDeps' }, '3 lines added');
changed('0:53.6', T, r2, 'src/app.ts', 3, 0);
tool('0:54.2', '0:54.6', T, r2, 'edit_file', { path: 'src/routes/webhooks.ts', summary: '429 with Retry-After after the tenant check' }, '6 lines added');
changed('0:55.0', T, r2, 'src/routes/webhooks.ts', 6, 0);
tool('0:55.6', '0:57.4', T, r2, 'shell', { command: 'bun run typecheck' }, 'exit 0');
say('0:57.7', T, r2, 'Typecheck is clean. Writing the limiter unit tests.');
tool('0:57.9', '0:58.2', T, r2, 'read_file', { path: 'test/backoff.test.ts' }, '12 lines');
tool('0:58.5', '0:59.0', T, r2, 'write_file', { path: 'test/limiter.test.ts' }, 'wrote 23 lines');
changed('0:59.4', T, r2, 'test/limiter.test.ts', 23, 0);
tool('0:59.6', '1:00.4', T, r2, 'shell', { command: 'bunx vitest run test/limiter.test.ts' }, 'Tests  3 passed (3)');
tool('1:00.6', '1:01.6', T, r2, 'shell', { command: 'bun run test' }, 'Tests  30 passed (30)');
say('1:02', T, r2, 'Limiter tests pass. Next: the 429 response tests in test/ratelimit.test.ts.');
tool('1:02.6', '1:02.8', T, r2, 'read_file', { path: 'test/webhooks.test.ts' }, '57 lines');
emit('1:03.6', T, 'agent.tool_call', { tool: 'write_file', args: { path: 'test/ratelimit.test.ts' }, callId: `call_${String(++callN).padStart(3, '0')}` }, r2);

// 1:05, the kill: SIGKILL to the run's process group, from the terminal pane.
emit('1:05', T, 'human.command', { command: 'pkill -9 -f "muse exec"', where: 'terminal pane' }, { vendor: 'human' }, { beat: 'Kill it' });
const c2 = await commitStep('1:05.6', 'stint/T-0042', 'T-0042-r2.patch', 'wip(T-0042 r2): killed');
emit('1:05.6', T, 'run.finished', { endedBy: 'killed', inFlight: 'write_file test/ratelimit.test.ts', cost: COST.t42r2, host: 'local-cli', sessionId: '01a1787f-4d06-7ca1-8d41-34127655ceb9', commit: c2.sha }, r2, { apply: c2 });
emit('1:06.6', T, 'verification.ran', { command: 'bun run test', exitCode: 0, passed: 30, failed: 0, durationMs: 1630, status: 'green', runBy: 'daemon' }, { run: 'r2', vendor: 'daemon' });

function packet(draft: Omit<Handoff, 'hash'>): Handoff {
  return HandoffSchema.parse({ ...draft, hash: hashHandoff(draft) });
}

const H1 = packet({
  version: 'stint.handoff/1',
  task: T,
  from: { adapter: 'muse-code', vendor: 'meta', model: 'muse-spark-1.3', role: 'implementer', run: 'r2', endedBy: 'killed', sessionId: '01a1787f-4d06-7ca1-8d41-34127655ceb9', host: 'local-cli' },
  to: { adapter: 'claude-code', role: 'implementer' },
  summary: 'Added a per-tenant sliding window limiter and wired it into POST /webhooks. The run was killed while writing the 429 tests.',
  done: ['Sliding window limiter in src/lib/limiter.ts', 'Limiter wired into POST /webhooks', 'Three limiter unit tests pass'],
  open: ['Tests for the 429 response and the Retry-After header', 'A test that other tenants are not affected'],
  leftOut: ['In-flight step unknown: write_file test/ratelimit.test.ts', 'Limiter state across restarts was not looked at'],
  refusals: [],
  decisions: [
    { id: 'D1', text: 'Count requests per tenant, not per source IP' },
    { id: 'D2', text: 'Answer 429 with a Retry-After header, never 503' },
    { id: 'D3', text: 'Sliding window over fixed window, so a burst at a window edge cannot double the limit' },
  ],
  risks: ['Limiter state is in memory and resets on restart', 'The limit of 60 per minute is hard-coded'],
  changedFiles: [
    { path: 'src/app.ts', added: 3, removed: 0, run: 'r2' },
    { path: 'src/lib/limiter.ts', added: 26, removed: 0, run: 'r2' },
    { path: 'src/routes/webhooks.ts', added: 6, removed: 0, run: 'r2' },
    { path: 'test/limiter.test.ts', added: 23, removed: 0, run: 'r2' },
  ],
  diffRef: { base: BASE, head: c2.sha },
  verification: { command: 'bun run test', exitCode: 0, passed: 30, failed: 0, durationMs: 1630, runBy: 'daemon', status: 'green' },
  askOfNext: 'Check the unknown step first: test/ratelimit.test.ts may be half written. Then test 429 and Retry-After.',
  cost: COST.t42r2,
  createdAt: iso(at('1:07.5')),
});
const h1Text = renderHandoff(H1);
const h1Tokens = countTokens(h1Text);
if (h1Tokens !== 412) throw new Error(`the killed packet must render to 412 tokens, got ${h1Tokens} (${h1Text.length} chars)`);
const bytes = (h: Handoff) => new TextEncoder().encode(renderHandoff(h)).length;
const handoffPayload = (name: string, h: Handoff, reason: string) => ({ name, hash: h.hash, from: h.from, to: h.to, tokens: countTokens(renderHandoff(h)), bytes: bytes(h), reason, packet: h });
emit('1:07.5', T, 'handoff.created', handoffPayload('h1', H1, 'killed'), { run: 'r2', vendor: 'daemon' }, { links: [{ kind: 'handoff', ref: 'h1' }] });

// 1:20, a different agent continues from the packet alone.
const r3: Ctx = { run: 'r3', adapter: 'claude-code', vendor: 'meta' };
emit('1:20', T, 'run.started', { role: 'implementer', model: 'muse-spark-1.3', host: 'meta-api', handoffFrom: 'h1', worktree: '.stint/worktrees/T-0042-r3', skills: ['review-voice-policy'] }, r3, { beat: 'A different agent finishes' });
emit('1:20.4', T, 'skill.applied', { skill: 'review-voice-policy', run: 'r3' }, { run: 'r3', vendor: 'daemon' }, { links: [{ kind: 'skill', ref: 'review-voice-policy' }] });
say('1:21', T, r3, 'Checking the unknown step first: test/ratelimit.test.ts.');
tool('1:21.6', '1:21.9', T, r3, 'Read', { file_path: 'test/ratelimit.test.ts' }, 'File does not exist.');
say('1:22.5', T, r3, 'The in-flight write never landed, so there is nothing to undo. The limiter and its tests from r2 are in place; I will not redo them.');
tool('1:22.8', '1:23.0', T, r3, 'Bash', { command: 'git log --oneline -2' }, 'wip(T-0042 r2): killed; Ignore local env files');
tool('1:23.2', '1:23.4', T, r3, 'Read', { file_path: 'src/lib/limiter.ts' }, '26 lines');
tool('1:23.9', '1:24.1', T, r3, 'Read', { file_path: 'src/routes/webhooks.ts' }, '39 lines');
tool('1:24.6', '1:24.8', T, r3, 'Read', { file_path: 'test/helpers.ts' }, '17 lines');
tool('1:24.9', '1:25.1', T, r3, 'Grep', { pattern: 'Retry-After', path: 'src' }, '1 match in src/routes/webhooks.ts');
say('1:25.4', T, r3, 'Tests can swap deps.limiter for a small limit, so no test needs 61 requests.');
tool('1:26.2', '1:26.8', T, r3, 'Write', { file_path: 'test/ratelimit.test.ts' }, 'wrote 35 lines');
changed('1:27.2', T, r3, 'test/ratelimit.test.ts', 35, 0);
tool('1:27.5', '1:28.2', T, r3, 'Bash', { command: 'bunx vitest run test/ratelimit.test.ts' }, 'Tests  3 passed (3)');
tool('1:28.4', '1:29.6', T, r3, 'Bash', { command: 'bun run test' }, 'Tests  33 passed (33)');
emit('1:30.4', T, 'agent.tool_call', { tool: 'Bash', args: { command: 'git push origin stint/T-0042' }, callId: `call_${String(++callN).padStart(3, '0')}` }, r3);
emit('1:30.6', T, 'rule.blocked', { action: 'git push origin stint/T-0042', reason: 'pushing is the human\'s call; Stint merges on approve', by: 'stint-rules', gate: 'enforced' }, { run: 'r3', vendor: 'daemon' });
say('1:31.5', T, r3, 'Done: the 429 response, Retry-After and tenant isolation are tested. The limit is still a constant in the limiter, as the packet\'s risks say.');
const c3 = await commitStep('1:33', 'stint/T-0042', 'T-0042-r3.patch', 'wip(T-0042 r3): completed');
emit('1:33', T, 'run.finished', { endedBy: 'completed', cost: COST.t42r3, host: 'meta-api', sessionId: 'b7c2e1d4-5f60-4a8b-9c3d-2e1f0a9b8c7d', commit: c3.sha }, r3, { apply: c3 });
emit('1:34.2', T, 'verification.ran', { command: 'bun run test', exitCode: 0, passed: 33, failed: 0, durationMs: 1710, status: 'green', runBy: 'daemon' }, { run: 'r3', vendor: 'daemon' });

const H2 = packet({
  version: 'stint.handoff/1',
  task: T,
  from: { adapter: 'claude-code', vendor: 'meta', model: 'muse-spark-1.3', role: 'implementer', run: 'r3', endedBy: 'completed', sessionId: 'b7c2e1d4-5f60-4a8b-9c3d-2e1f0a9b8c7d', host: 'meta-api' },
  to: { adapter: 'openai-compatible', role: 'reviewer' },
  summary: 'Continued from the killed run: the unknown step had not landed, so it added the 429, Retry-After and tenant isolation tests. 33 tests pass.',
  done: ['Sliding window limiter wired into POST /webhooks (r2)', 'Tests for 429 with Retry-After and for tenant isolation'],
  open: [],
  leftOut: ['Limiter state across restarts was not looked at'],
  refusals: [{ action: 'git push origin stint/T-0042', by: 'stint-rules', reason: 'pushing is the human\'s call; Stint merges on approve' }],
  decisions: H1.decisions,
  risks: H1.risks,
  changedFiles: [...H1.changedFiles, { path: 'test/ratelimit.test.ts', added: 35, removed: 0, run: 'r3' }],
  diffRef: { base: BASE, head: c3.sha },
  verification: { command: 'bun run test', exitCode: 0, passed: 33, failed: 0, durationMs: 1710, runBy: 'daemon', status: 'green' },
  askOfNext: 'Review the limiter and its tests against D1 to D3 and the conventions in AGENTS.md.',
  cost: COST.t42r3,
  createdAt: iso(at('1:35')),
});
emit('1:35', T, 'handoff.created', handoffPayload('h2', H2, 'completed'), { run: 'r3', vendor: 'daemon' }, { links: [{ kind: 'handoff', ref: 'h2' }] });
emit('1:36', T, 'task.status', { from: 'building', to: 'reviewing' }, { vendor: 'daemon' });

// 1:45, review offline: Wi-Fi off, Glimmer on the laptop at $0.00.
emit('1:45', T, 'human.command', { command: 'networksetup -setairportpower en0 off', where: 'terminal pane' }, { vendor: 'human' }, { beat: 'Review offline' });
const r4: Ctx = { run: 'r4', adapter: 'openai-compatible', vendor: 'meta' };
emit('1:46', T, 'run.started', { role: 'reviewer', model: 'muse-glimmer:30b-mlx', host: 'ollama', offline: true, skills: ['review-voice-policy'] }, r4);
say('1:48', T, r4, 'Reading the packet, the 3 decisions valid now and the diff (5 files, 93 lines).');
say('1:52', T, r4, 'The limiter is checked before the body is read and the tests cover isolation. The limit and window are constants.');
say('1:55', T, r4, 'One note would reverse D3; marking it so it goes to the queue instead of being applied.');
emit('1:58', T, 'run.finished', { endedBy: 'completed', cost: COST.t42r4, host: 'ollama', offline: true }, r4);
const REVIEW_T42: Review = {
  version: 'stint.review/1',
  verdict: 'approve',
  summary: 'The limiter and its tests are sound. The limit is a constant; one note proposes reversing D3 and was routed to the queue.',
  findings: [
    { id: 'F1', severity: 'minor', file: 'src/lib/limiter.ts', line: 11, text: 'The limit of 60 per minute and the 60 s window are hard-coded; read them through loadConfig() like the other limits.', linksTo: 'R2' },
    { id: 'F2', severity: 'note', file: 'src/lib/limiter.ts', line: 6, text: 'A fixed window counter would use less memory per tenant than the sliding window log.', contradictsDecision: 'D3' },
  ],
  blockers: [],
  model: 'ollama/muse-glimmer:30b-mlx',
  offline: true,
  cost: COST.t42r4,
  run: 'r4',
  createdAt: iso(at('1:59')),
};
emit('1:59', T, 'review.recorded', { verdict: 'approve', findings: 2, contradictions: 1, offline: true, queued: ['contradiction-T-0042-F2'], review: REVIEW_T42 }, r4, { links: [{ kind: 'finding', ref: 'F1' }, { kind: 'finding', ref: 'F2' }, { kind: 'decision', ref: 'D3' }] });
emit('2:00', T, 'task.status', { from: 'reviewing', to: 'awaiting_approval' }, { vendor: 'daemon' });
emit('2:00.5', T, 'approval.requested', { verification: { passed: 33, failed: 0, status: 'green' }, review: 'approve' }, { vendor: 'daemon' });

// 2:05, approve and merge: one commit with the Stint trailers.
emit('2:05', T, 'approval.granted', { by: 'human', verificationRun: 'r3' }, { vendor: 'human' }, { beat: 'Approve and merge' });
const mergeMessage = `${TASKS[1]?.title} (T-0042)\n\n${H2.summary}\n\nStint-Task: T-0042\nStint-Runs: r1,r2,r3,r4\nStint-Handoff: ${H2.hash}\nStint-Verified: bun run test 33/33\n`;
const mergeStep: ApplyStep = { kind: 'merge', branch: 'stint/T-0042', into: 'main', message: mergeMessage, date: iso(at('2:05.5')) };
const mergeSha = await applyGitStep(repo, mergeStep);
emit('2:05.5', T, 'merge.completed', { branch: 'stint/T-0042', into: 'main', commit: mergeSha, trailers: { 'Stint-Task': 'T-0042', 'Stint-Runs': 'r1,r2,r3,r4', 'Stint-Handoff': H2.hash, 'Stint-Verified': 'bun run test 33/33' } }, { vendor: 'daemon' }, { apply: mergeStep, links: [{ kind: 'commit', ref: mergeSha }] });
emit('2:06', T, 'task.status', { from: 'awaiting_approval', to: 'done' }, { vendor: 'daemon' });

// 2:15, it learned: F1 recurs with T-0040's F2, so the learn step proposes a skill.
const PROPOSAL: SkillProposal = {
  version: 'stint.skillProposal/1',
  id: 'limiter-config-via-env',
  name: 'Limits come from config',
  description: 'Use when adding a limit, threshold, window or cap: read it through loadConfig() with a default, never as a constant.',
  roles: ['implementer', 'reviewer'],
  tags: ['limits', 'config'],
  rule: 'Every limit, threshold, window and cap is read through loadConfig() from an env var with a default. Add a config test for the default and one for the override. A reviewer flags a constant limit as a finding.',
  examples: [{ task: 'T-0042', run: 'r3', diff: 'src/lib/limiter.ts@HEAD' }],
  evidence: ['T-0042/r4#F1', 'T-0040/r3#F2'],
  confidence: 0.82,
  model: 'baseten/muse-spark-open',
  createdAt: iso(at('2:09')),
};
emit('2:09', T, 'skill.proposed', { id: PROPOSAL.id, evidence: PROPOSAL.evidence, confidence: PROPOSAL.confidence, host: 'baseten', model: 'muse-spark-open', cost: COST.learn, proposal: PROPOSAL }, { vendor: 'daemon' }, { beat: 'It learned', links: [{ kind: 'skill', ref: PROPOSAL.id }] });
const skillStep = await commitStep('2:12', 'main', 'skill-limiter-config-via-env.patch', `Add skill ${PROPOSAL.id}\n\nLearned from T-0042/r4#F1 and T-0040/r3#F2.\n\nStint-Skill: ${PROPOSAL.id}\n`);
emit('2:12', T, 'skill.approved', { id: PROPOSAL.id, by: 'human', path: `.agents/skills/${PROPOSAL.id}/SKILL.md`, commit: skillStep.sha }, { vendor: 'human' }, { apply: skillStep, links: [{ kind: 'skill', ref: PROPOSAL.id }] });

// T-0043 runs with the skill mounted.
const U = 'T-0043';
emit('2:14', U, 'task.status', { from: 'planned', to: 'building' }, { vendor: 'daemon' });
const u1: Ctx = { run: 'r1', adapter: 'muse-code', vendor: 'meta' };
emit('2:14.5', U, 'run.started', { role: 'implementer', model: 'muse-spark-1.3', host: 'local-cli', worktree: '.stint/worktrees/T-0043-r1', skills: ['limiter-config-via-env', 'review-voice-policy'] }, u1);
emit('2:14.8', U, 'skill.applied', { skill: 'limiter-config-via-env', run: 'r1' }, { run: 'r1', vendor: 'daemon' }, { links: [{ kind: 'skill', ref: 'limiter-config-via-env' }] });
emit('2:14.9', U, 'skill.applied', { skill: 'review-voice-policy', run: 'r1' }, { run: 'r1', vendor: 'daemon' }, { links: [{ kind: 'skill', ref: 'review-voice-policy' }] });
say('2:15.5', U, u1, 'Skill limiter-config-via-env applies: the admin limit and its window go through loadConfig() with defaults.');
tool('2:16.0', '2:16.2', U, u1, 'read_file', { path: 'src/routes/admin.ts' }, '31 lines');
tool('2:16.5', '2:16.7', U, u1, 'read_file', { path: 'src/lib/limiter.ts' }, '26 lines');
tool('2:17.0', '2:17.3', U, u1, 'edit_file', { path: 'src/config.ts', summary: 'ADMIN_RATE_LIMIT and ADMIN_RATE_WINDOW_MS with defaults' }, '4 lines added');
changed('2:17.6', U, u1, 'src/config.ts', 4, 0);
tool('2:18.0', '2:18.3', U, u1, 'edit_file', { path: 'src/app.ts', summary: 'adminLimiter from config' }, '2 lines added');
changed('2:18.6', U, u1, 'src/app.ts', 2, 0);
tool('2:19.0', '2:19.4', U, u1, 'edit_file', { path: 'src/routes/admin.ts', summary: '429 with Retry-After on every admin route' }, '9 lines added');
changed('2:19.7', U, u1, 'src/routes/admin.ts', 9, 0);
tool('2:20.2', '2:20.6', U, u1, 'edit_file', { path: 'test/config.test.ts', summary: 'default and override for the admin limit' }, '7 lines added, 2 removed');
changed('2:20.9', U, u1, 'test/config.test.ts', 7, 2);
tool('2:21.3', '2:21.7', U, u1, 'edit_file', { path: 'test/admin.test.ts', summary: '429 over the configured limit; window from config' }, '18 lines added');
changed('2:22.0', U, u1, 'test/admin.test.ts', 18, 0);
tool('2:22.4', '2:24.0', U, u1, 'shell', { command: 'bun run test' }, 'Tests  36 passed (36)');
const u1Commit = await commitStep('2:24.5', 'stint/T-0043', 'T-0043-r1.patch', 'wip(T-0043 r1): completed');
emit('2:24.5', U, 'run.finished', { endedBy: 'completed', cost: COST.t43r1, host: 'local-cli', sessionId: '01a17a2e-77b1-7c3d-9e40-5a6b7c8d9e0f', commit: u1Commit.sha }, u1, { apply: u1Commit });
emit('2:25.3', U, 'verification.ran', { command: 'bun run test', exitCode: 0, passed: 36, failed: 0, durationMs: 1790, status: 'green', runBy: 'daemon' }, { run: 'r1', vendor: 'daemon' });
const U1 = packet({
  version: 'stint.handoff/1',
  task: U,
  from: { adapter: 'muse-code', vendor: 'meta', model: 'muse-spark-1.3', role: 'implementer', run: 'r1', endedBy: 'completed', host: 'local-cli' },
  to: { adapter: 'openai-compatible', role: 'reviewer' },
  summary: 'Rate-limited the admin API with the sliding window limiter; the limit and window come from config with defaults, as the limiter-config-via-env skill says. 36 tests pass.',
  done: ['Admin routes answer 429 with Retry-After over the limit', 'ADMIN_RATE_LIMIT and ADMIN_RATE_WINDOW_MS read through loadConfig()', 'Tests for the defaults, the override and the 429'],
  open: [],
  leftOut: ['The admin limit is global, not per caller'],
  refusals: [],
  decisions: [],
  risks: ['Limiter state is in memory and resets on restart'],
  changedFiles: [
    { path: 'src/app.ts', added: 2, removed: 0, run: 'r1' },
    { path: 'src/config.ts', added: 4, removed: 0, run: 'r1' },
    { path: 'src/routes/admin.ts', added: 9, removed: 0, run: 'r1' },
    { path: 'test/admin.test.ts', added: 18, removed: 0, run: 'r1' },
    { path: 'test/config.test.ts', added: 7, removed: 2, run: 'r1' },
  ],
  diffRef: { base: skillStep.sha, head: u1Commit.sha },
  verification: { command: 'bun run test', exitCode: 0, passed: 36, failed: 0, durationMs: 1790, runBy: 'daemon', status: 'green' },
  askOfNext: 'Review the admin limiter against AGENTS.md and the limiter-config-via-env skill.',
  cost: COST.t43r1,
  createdAt: iso(at('2:26')),
});
emit('2:26', U, 'handoff.created', handoffPayload('h1', U1, 'completed'), { run: 'r1', vendor: 'daemon' }, { links: [{ kind: 'handoff', ref: 'h1' }] });
emit('2:26.5', U, 'task.status', { from: 'building', to: 'reviewing' }, { vendor: 'daemon' });
const u2: Ctx = { run: 'r2', adapter: 'openai-compatible', vendor: 'meta' };
emit('2:27', U, 'run.started', { role: 'reviewer', model: 'muse-glimmer:30b-mlx', host: 'ollama', offline: true, skills: ['review-voice-policy', 'limiter-config-via-env'] }, u2);
say('2:29', U, u2, 'Limits are read from config with defaults and tested both ways. Nothing to flag.');
emit('2:31', U, 'run.finished', { endedBy: 'completed', cost: COST.t43r2, host: 'ollama', offline: true }, u2);
const REVIEW_T43: Review = { version: 'stint.review/1', verdict: 'approve', summary: 'No actionable findings.', findings: [], blockers: [], model: 'ollama/muse-glimmer:30b-mlx', offline: true, cost: COST.t43r2, run: 'r2', createdAt: iso(at('2:32')) };
emit('2:32', U, 'review.recorded', { verdict: 'approve', findings: 0, contradictions: 0, offline: true, review: REVIEW_T43 }, u2);
emit('2:33', U, 'task.status', { from: 'reviewing', to: 'awaiting_approval' }, { vendor: 'daemon' });
emit('2:35', U, 'approval.requested', { verification: { passed: 36, failed: 0, status: 'green' }, review: 'approve' }, { vendor: 'daemon' }, { beat: 'Close' });

// ---- write -------------------------------------------------------------------------------------------------
const header: RecordingHeader = { version: 'stint.recording/1', title: 'Stint: one task, four agents, three survivals (hand-written)', recordedAt: RECORDED_AT, live: false, tasks: TASKS };
await Bun.write(join(ROOT, 'demo', 'recording.jsonl'), `${[header, ...lines].map((l) => JSON.stringify(l)).join('\n')}\n`);

// The three example packets: the killed one is the demo's h1; completed and capped are its siblings.
const examples = join(ROOT, 'packages', 'core', 'schemas', 'examples');
const sibling = (over: Partial<Omit<Handoff, 'hash'>>) => {
  const { hash: _h, ...rest } = H1;
  return packet({ ...rest, ...over });
};
const completed = sibling({
  from: { ...H1.from, endedBy: 'completed', sessionId: '01a1787f-4d06-7ca1-8d41-34127655ceb0' },
  to: { adapter: 'openai-compatible', role: 'reviewer' },
  summary: 'Rate-limited POST /webhooks per tenant with a sliding window and a 429 response with Retry-After. The tests are green.',
  done: ['Sliding window limiter in src/lib/limiter.ts', 'POST /webhooks answers 429 with Retry-After over the limit', 'Limiter and 429 tests'],
  open: [],
  leftOut: ['Limiter state across restarts was not looked at'],
  verification: { command: 'bun run test', exitCode: 0, passed: 31, failed: 0, durationMs: 1700, runBy: 'daemon', status: 'green' },
  askOfNext: 'Review the limiter against D1 to D3 and AGENTS.md.',
});
const capped = sibling({
  from: { ...H1.from, endedBy: 'capped', sessionId: '01a1787f-4d06-7ca1-8d41-34127655ceb1' },
  summary: 'Reached the 60-step cap after adding the limiter and wiring it into POST /webhooks. No tests were written yet.',
  done: ['Sliding window limiter in src/lib/limiter.ts', 'Limiter wired into POST /webhooks'],
  open: ['Unit tests for the limiter', 'Tests for the 429 response and the Retry-After header'],
  leftOut: ['No tests were written for the limiter yet'],
  changedFiles: H1.changedFiles.filter((f) => !f.path.startsWith('test/')),
  verification: { command: 'bun run test', exitCode: 0, passed: 27, failed: 0, durationMs: 1490, runBy: 'daemon', status: 'green' },
  askOfNext: 'Add the limiter unit tests first, then the 429 response tests.',
});
for (const [name, h] of Object.entries({ completed, killed: H1, capped })) {
  await Bun.write(join(examples, `handoff-${name}.json`), `${JSON.stringify(h, null, 2)}\n`);
}
// docs/packet.md shows the killed packet as the next agent reads it; keep it in step with the example.
const docPath = join(ROOT, 'docs', 'packet.md');
const doc = readFileSync(docPath, 'utf8');
const marker = doc.indexOf('rendered: ');
const open = doc.indexOf('```\n', marker);
if (marker < 0 || open < 0) throw new Error('docs/packet.md has no rendered example block');
await Bun.write(docPath, `${doc.slice(0, marker)}rendered: ${h1Tokens} tokens, ${(bytes(H1) / 1024).toFixed(1)} KB.\n\n\`\`\`\n${h1Text}\`\`\`\n`);
rmSync(repo, { recursive: true, force: true });
const perTask = [...seqs.entries()].map(([t, s]) => `${t} ${s.seq}`).join(', ');
process.stdout.write(`recording: ${lines.length} events (${perTask}); killed packet ${h1Tokens} tokens, ${bytes(H1)} bytes; T-0042 total $${t42Total.toFixed(4)}\n`);
