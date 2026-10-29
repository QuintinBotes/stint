import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ScorecardAttempt, ScorecardSchema } from '../../packages/core/src/index';
import type { RelayRecord } from '../relay';
import { SPARK_OPEN, buildScorecard, renderScorecard, runScorecard, scorecardConfig } from '../scorecard';

const root = join(import.meta.dir, '..', '..');
const SECRET = 'held-out-marker-3b9e';
let dir = '';
let bench = '';
let out = '';
// commits in the fixture and the clone need an identity and no signing, on any machine
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Scorecard Test',
  GIT_AUTHOR_EMAIL: 'scorecard@example.com',
  GIT_COMMITTER_NAME: 'Scorecard Test',
  GIT_COMMITTER_EMAIL: 'scorecard@example.com',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
};

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};

const scorecard = (...args: string[]) => {
  const r = Bun.spawnSync(['bun', join(root, 'scripts', 'scorecard.ts'), ...args, '--relay', bench, '--work', join(dir, 'work'), '--out', out], { env, stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

const filesUnder = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(d, e.name)) : [join(d, e.name)]));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'stint-scorecardtest-'));
  const origin = join(dir, 'origin');
  mkdirSync(origin);
  writeFileSync(join(origin, 'README.md'), '# fixture\n');
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'fixture');
  bench = join(dir, 'bench');
  out = join(dir, 'out');
  // green once the run wrote its task file, red whenever the impossible hidden test is present
  const testCommand = `sh -c 'test -f "src/lib/$STINT_TASK.ts" && ! test -f test/impossible.txt && printf " 1 pass\\n 0 fail\\n" || { printf " 0 pass\\n 1 fail\\n"; exit 1; }'`;
  for (const [task, file] of [['fixture-holds', 'holdout'], ['fixture-fails', 'impossible']]) {
    mkdirSync(join(bench, 'scenarios', task as string, 'test'), { recursive: true });
    writeFileSync(join(bench, 'scenarios', task as string, 'test', `${file}.txt.txt`), `${SECRET}\n`);
  }
  writeFileSync(join(bench, 'repos.json'), JSON.stringify({ repos: [{ id: 'fixture', name: 'local/fixture', url: origin, licence: 'MIT', commit: git(origin, 'rev-parse', 'HEAD'), install: 'true', testCommand }] }));
  // the fake reviewer asks for changes on a change whose title says [learn]
  writeFileSync(
    join(bench, 'tasks.json'),
    JSON.stringify({
      tasks: [
        { id: 'fixture-holds', repo: 'fixture', kind: 'relay', title: 'Fixture that holds', goal: 'The hidden test passes.', acceptance: ['the task file exists'], scenarios: ['test/holdout.txt'] },
        { id: 'fixture-fails', repo: 'fixture', kind: 'relay', title: '[learn] Fixture that fails', goal: 'The hidden test fails.', acceptance: ['the task file exists'], scenarios: ['test/impossible.txt'] },
        { id: 'fixture-control', repo: 'fixture', kind: 'control', title: 'Not scored', goal: 'A control is not an attempt.', acceptance: ['the task file exists'] },
      ],
    }),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('a dry scorecard runs k attempts per seeded relay task, reviews before the hidden tests grade, and publishes each attempt', async () => {
  const r = scorecard('--dry', '--k', '2');
  expect(r.code, r.err).toBe(0);
  expect(r.out).toContain('ran 4 attempts; 4 recorded');
  const card = ScorecardSchema.parse(JSON.parse(readFileSync(join(out, 'scorecard.json'), 'utf8')));
  expect(card.live).toBe(false);
  expect(card.attempts.map((a) => [a.task, a.attempt, a.adapter, a.model, a.tests, a.review?.verdict, a.hidden, a.scenarios])).toEqual([
    ['fixture-fails', 1, 'stint-agent', SPARK_OPEN, 'green', 'request_changes', 'red', { passed: 0, failed: 1 }],
    ['fixture-fails', 2, 'stint-agent', SPARK_OPEN, 'green', 'request_changes', 'red', { passed: 0, failed: 1 }],
    ['fixture-holds', 1, 'stint-agent', SPARK_OPEN, 'green', 'approve', 'green', { passed: 1, failed: 0 }],
    ['fixture-holds', 2, 'stint-agent', SPARK_OPEN, 'green', 'approve', 'green', { passed: 1, failed: 0 }],
  ]);
  expect(card.tasks.map((t) => [t.id, t.attempts, t.green, t.pass1, t.passK])).toEqual([
    ['fixture-fails', 2, 0, { value: 0, n: 2 }, { value: 0, n: 2 }],
    ['fixture-holds', 2, 2, { value: 1, n: 2 }, { value: 1, n: 2 }],
  ]);
  expect(card.overall).toEqual({ pass1: { value: 0.5, n: 4 }, passK: { value: 0.5, n: 2 } });
  expect(card.review).toEqual({ n: 4, caught: 2, missed: 0, falseAlarm: 0, agreed: 2 });
  expect(card.badPatches).toEqual({ n: 2, byTests: { value: 0, n: 2 }, byTestsAndReview: { value: 1, n: 2 } });
  expect(card.models.map((m) => [m.source, m.role, m.adapter, m.runs])).toEqual([
    ['attempts', 'implementer', 'stint-agent', 4],
    ['attempts', 'reviewer', 'openai-compatible', 4],
  ]);
  expect(card.spend.usd).toBeGreaterThan(0);
  // the hidden test reached the daemon only after the review, and never an agent; nothing names the temp folder
  const attempt = join(out, 'scorecard', 'fixture-fails-a1');
  const task = card.attempts[0]?.stintTask as string;
  const types = readFileSync(join(attempt, 'tasks', task, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { type: string }).type);
  expect(types.indexOf('review.recorded')).toBeGreaterThan(-1);
  expect(types.indexOf('scenario.ran')).toBeGreaterThan(types.indexOf('review.recorded'));
  for (const f of filesUnder(join(out, 'scorecard'))) {
    const text = readFileSync(f, 'utf8');
    expect(text.includes(SECRET), f).toBe(false);
    expect(text.includes(dir), f).toBe(false);
  }
  expect(existsSync(join(attempt, 'tasks', task, 'diff.patch'))).toBe(true);
}, 180_000);

test('a rerun skips every attempt already recorded, and --budget-usd stops before the next one', () => {
  const again = scorecard('--dry', '--k', '2');
  expect(again.code, again.err).toBe(0);
  expect(again.out).toContain('ran 0 attempts; 4 recorded');
  const budget = scorecard('--dry', '--k', '3', '--budget-usd', '0.001');
  expect(budget.code, budget.err).toBe(0);
  expect(budget.out).toStartWith('stopped before fixture-holds attempt 3: recorded spend $0.00');
  expect(budget.out).toContain('would pass the $0.001 budget');
  expect(readdirSync(join(out, 'scorecard')).sort()).toEqual(['fixture-fails-a1', 'fixture-fails-a2', 'fixture-holds-a1', 'fixture-holds-a2']);
});

test('--render prints the table from scorecard.json', () => {
  const r = scorecard('--render');
  expect(r.code, r.err).toBe(0);
  expect(r.out).toContain('| pass^3, all tasks | none yet | 0 tasks with 3 graded attempts |');
  expect(r.out).toContain('| Review caught: asked for changes, hidden tests red | 2 | 4 reviewed attempts |');
});

test('a live run refuses a folder that holds dry attempts before it clones anything', async () => {
  await expect(runScorecard({ dry: false, k: 3, relay: bench, out, work: join(dir, 'live-work'), budgetUsd: null, render: false })).rejects.toThrow('holds dry attempts; a live run writes to another --out');
  expect(existsSync(join(dir, 'live-work'))).toBe(false);
});

test('an attempt runs the Stint agent on Baseten only, reviews on Glimmer offline, and keeps the hidden tests outside the clone', () => {
  const repo = { id: 'r', name: 'o/r', url: 'u', licence: 'MIT', commit: 'c'.repeat(40), install: 'true', testCommand: 'npm test', removeInBaseline: [] };
  const config = scorecardConfig(repo, '/scenarios', null);
  expect(config.routes.agent).toEqual(['baseten/muse-spark-open']);
  expect(config.hosts.baseten?.models['muse-spark-open']).toBe('meta-models/muse-spark-open-1026');
  expect(config.routes.reviewer).toEqual(['ollama/muse-glimmer:30b-mlx']);
  expect(config.routes.summary).toEqual(['ollama/muse-glimmer:30b-mlx']);
  expect(config.autopilot?.onCreate).toBeUndefined();
  expect(config.verify).toEqual({ checks: [], tamper: 'fail' });
  expect(config.scenarios).toEqual({ dir: '/scenarios', command: 'npm test' });
});

// ---------------------------------------------------------------------------------------------------------------

const attempt = (task: string, n: number, over: Partial<ScorecardAttempt>): ScorecardAttempt => ({
  task,
  repo: task === 'alpha' ? 'ra' : 'rb',
  attempt: n,
  live: true,
  stintTask: 'T-0001',
  run: 'r1',
  adapter: 'stint-agent',
  model: 'muse-spark-open',
  host: 'baseten',
  endedBy: 'completed',
  tests: 'green',
  hidden: 'green',
  scenarios: { passed: 8, failed: 0 },
  review: null,
  usd: 0.1,
  estimated: false,
  wallMs: 60_000,
  retried: [],
  outcome: 'graded',
  startedAt: '2026-10-30T10:00:00.000Z',
  finishedAt: '2026-10-30T10:10:00.000Z',
  ...over,
});
const glimmer = (verdict: 'approve' | 'request_changes' | 'block') => ({ verdict, findings: verdict === 'approve' ? [] : [{ severity: 'major' as const, text: 'The option is not documented' }], adapter: 'openai-compatible', model: 'muse-glimmer:30b-mlx', host: 'ollama', offline: true });
const hops = (...verdicts: Array<'green' | 'red'>) =>
  verdicts.map((verification, i) => ({ hop: i + 1, adapter: ['muse-code', 'claude-code', 'codex'][i], run: `r${i + 1}`, model: 'm', host: ['local-cli', 'ollama', 'meta-api'][i], endedBy: 'completed', stoppedByRelay: null, handoffFrom: i ? `h${2 * i}` : null, packetLeft: `h${2 * i + 1}`, verification, usd: null }));
const relay = (dir: string, live: boolean, ...verdicts: Array<'green' | 'red'>) => ({ dir, record: { kind: 'relay', live, hops: hops(...verdicts) } as unknown as RelayRecord });

const literal = buildScorecard({
  k: 3,
  live: true,
  generatedAt: '2026-10-30T12:00:00.000Z',
  attempts: [
    attempt('beta', 3, { run: null, endedBy: null, tests: null, hidden: null, scenarios: null, usd: null, estimated: true, wallMs: null, outcome: 'failed: the host did not answer' }),
    attempt('alpha', 1, { review: glimmer('approve'), usd: 0.2, wallMs: 600_000 }),
    attempt('alpha', 2, { review: glimmer('request_changes'), usd: 0.4, wallMs: 300_000 }),
    attempt('alpha', 3, { review: glimmer('approve'), hidden: 'red', scenarios: { passed: 6, failed: 2 }, usd: 0.3 }),
    attempt('beta', 1, { tests: 'red', hidden: 'red', usd: 0.1 }),
    attempt('beta', 2, { review: glimmer('block'), hidden: 'red', usd: 0.25 }),
  ],
  relays: [relay('negotiator', true, 'red', 'red', 'green'), relay('wait-on', true, 'red', 'red', 'red'), relay('wait-on-dry', false, 'red', 'green', 'green')],
});

test('the aggregate: pass^k as R-046 defines it, hand-off success from the live relays, and the review against the hidden tests', () => {
  expect(ScorecardSchema.safeParse(literal).success).toBe(true);
  expect(literal.tasks).toEqual([
    { id: 'alpha', repo: 'ra', attempts: 3, green: 2, pass1: { value: 0.6667, n: 3 }, passK: { value: 0, n: 3 } },
    { id: 'beta', repo: 'rb', attempts: 3, green: 0, pass1: { value: 0, n: 2 }, passK: { value: null, n: 2 } },
  ]);
  expect(literal.overall).toEqual({ pass1: { value: 0.4, n: 5 }, passK: { value: 0, n: 1 } });
  expect(literal.handoff).toEqual({ value: 0.25, n: 4, green: 1, relays: ['negotiator', 'wait-on'] });
  expect(literal.review).toEqual({ n: 4, caught: 1, missed: 1, falseAlarm: 1, agreed: 1 });
  expect(literal.badPatches).toEqual({ n: 3, byTests: { value: 0.3333, n: 3 }, byTestsAndReview: { value: 0.6667, n: 3 } });
  expect(literal.perGreen).toEqual({ usd: { value: 0.3, n: 2, unpriced: 0 }, wallMs: { value: 450_000, n: 2 } });
  expect(literal.spend).toEqual({ usd: 1.25, estimated: true });
  expect(literal.models.map((m) => [m.source, m.role, m.adapter, m.host, m.runs])).toEqual([
    ['attempts', 'implementer', 'stint-agent', 'baseten', 5],
    ['attempts', 'reviewer', 'openai-compatible', 'ollama', 4],
    ['relays', 'implementer', 'muse-code', 'local-cli', 2],
    ['relays', 'implementer', 'claude-code', 'ollama', 2],
    ['relays', 'implementer', 'codex', 'meta-api', 2],
  ]);
});

test('the renderer prints the markdown table the lead pastes into docs/proofs.md', () => {
  expect(renderScorecard(literal)).toBe(
    [
      'Scorecard (live): k 3, 6 attempts on 2 seeded tasks, spend $1.2500 (part unpriced), generated 2026-10-30.',
      '',
      '| Figure | Result | Rests on |',
      '|---|---|---|',
      '| pass^1, alpha | 2 of 3 (67%) | 3 graded attempts |',
      '| pass^3, alpha | no, 2 of 3 green | 3 graded attempts |',
      '| pass^1, beta | 0 of 2 (0%) | 2 graded attempts |',
      '| pass^3, beta | not yet | 2 graded attempts |',
      '| pass^1, all tasks | 2 of 5 (40%) | 5 graded attempts |',
      '| pass^3, all tasks | 0 of 1 (0%) | 1 task with 3 graded attempts |',
      '| Hand-off success: continued runs that went green | 1 of 4 (25%) | 4 continued runs in 2 relays |',
      '| Bad patches stopped by the tests alone | 1 of 3 (33%) | 3 attempts the hidden tests failed |',
      '| Bad patches stopped by the tests or the review | 2 of 3 (67%) | 3 attempts the hidden tests failed |',
      '| Review caught: asked for changes, hidden tests red | 1 | 4 reviewed attempts |',
      '| Review missed: approved, hidden tests red | 1 | 4 reviewed attempts |',
      '| Review false alarm: asked for changes, hidden tests green | 1 | 4 reviewed attempts |',
      '| Review agreed: approved, hidden tests green | 1 | 4 reviewed attempts |',
      '| Cost per green attempt | $0.3000 | 2 green attempts |',
      '| Wall time per green attempt | 7.5 min | 2 green attempts |',
      '',
      'The attempts ran stint-agent on baseten/muse-spark-open as implementer (5 runs), openai-compatible on ollama/muse-glimmer:30b-mlx as reviewer (4 runs). The relays ran muse-code on local-cli/m as implementer (2 runs), claude-code on ollama/m as implementer (2 runs), codex on meta-api/m as implementer (2 runs).',
      '',
    ].join('\n'),
  );
  // at k 1, pass^k is pass^1, so it is printed once
  expect(renderScorecard({ ...literal, k: 1 }).match(/\| pass\^1, all tasks \|/g)).toHaveLength(1);
});
