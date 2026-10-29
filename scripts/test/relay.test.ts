import { afterAll, beforeAll, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCRIPTED_BY, liveEnvProblem, readPublished, relayConfig, relayProblems } from '../relay';

const root = join(import.meta.dir, '..', '..');
const SECRET = 'held-out-marker-7c1f';
let dir = '';
let bench = '';
// commits in the fixture and the clone need an identity and no signing, on any machine
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Relay Test',
  GIT_AUTHOR_EMAIL: 'relay@example.com',
  GIT_COMMITTER_NAME: 'Relay Test',
  GIT_COMMITTER_EMAIL: 'relay@example.com',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
};

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};

const relay = (...args: string[]) => {
  const r = Bun.spawnSync(['bun', join(root, 'scripts', 'relay.ts'), ...args, '--bench', bench, '--work', join(dir, 'work')], { env, stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

const filesUnder = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(d, e.name)) : [join(d, e.name)]));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'stint-relaytest-'));
  const origin = join(dir, 'origin');
  mkdirSync(origin);
  writeFileSync(join(origin, 'README.md'), '# fixture\n');
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'fixture');
  bench = join(dir, 'bench');
  // green once the run wrote its task file, red whenever the impossible scenario is present
  const testCommand = `sh -c 'test -f "src/lib/$STINT_TASK.ts" && ! test -f test/impossible.txt && printf " 1 pass\\n 0 fail\\n" || { printf " 0 pass\\n 1 fail\\n"; exit 1; }'`;
  mkdirSync(join(bench, 'scenarios', 'fixture-relay', 'test'), { recursive: true });
  mkdirSync(join(bench, 'scenarios', 'fixture-control', 'test'), { recursive: true });
  writeFileSync(join(bench, 'scenarios', 'fixture-relay', 'test', 'holdout.txt.txt'), `${SECRET}\n`);
  writeFileSync(join(bench, 'scenarios', 'fixture-control', 'test', 'impossible.txt.txt'), `${SECRET}\n`);
  writeFileSync(join(bench, 'repos.json'), JSON.stringify({ repos: [{ id: 'fixture', name: 'local/fixture', url: origin, licence: 'MIT', commit: git(origin, 'rev-parse', 'HEAD'), install: 'true', testCommand }] }));
  const task = (id: string, kind: string) => ({ id, repo: 'fixture', kind, title: `Fixture ${kind}`, goal: `The ${kind} on a fixture.`, acceptance: ['the task file exists'], scenarios: [`test/${kind === 'control' ? 'impossible' : 'holdout'}.txt`] });
  // the fake reviewer flags the same hard-coded limit in every change whose title says [learn]
  const learning = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `fixture-learn-${n}`, repo: 'fixture', kind: 'learning', tags: ['limits'], title: `[learn] Fixture step ${n}`, goal: `Step ${n} of the sequence.`, acceptance: ['the task file exists'] }));
  writeFileSync(join(bench, 'tasks.json'), JSON.stringify({ tasks: [task('fixture-relay', 'relay'), task('fixture-control', 'control'), ...learning] }));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('a dry relay stops Muse Code, hands its packet to Claude Code, then Codex, verifies, reviews and stops at the gate', async () => {
  const r = relay('fixture', '--dry');
  expect(r.code, r.err).toBe(0);
  expect(r.out).toContain('at the gate');
  const out = join(bench, 'fixture-dry');
  expect(await relayProblems(out)).toEqual([]);
  const { record, events } = await readPublished(out);
  expect(record.live).toBe(false);
  expect(record.end).toBe('at-gate');
  expect(record.gate).toBe(true);
  expect(record.hops.map((h) => [h.adapter, h.endedBy, h.verification, h.handoffFrom, h.packetLeft])).toEqual([
    ['muse-code', 'killed', 'red', null, 'h1'],
    ['claude-code', 'completed', 'green', 'h2', 'h3'],
    ['codex', 'completed', 'green', 'h4', 'h5'],
  ]);
  expect(record.hops[0]?.stoppedByRelay).toBe('stopped by the relay after 1 tool calls');
  expect(record.review?.verdict).toBe('approve');
  const task = record.tasks[0] as string;
  const rows = events.get(task) ?? [];
  expect(rows.filter((e) => e.type === 'scenario.ran').map((e) => [e.run, e.payload.passed, e.payload.failed])).toEqual([
    ['r1', 0, 1],
    ['r2', 1, 0],
    ['r3', 1, 0],
  ]);
  // the held-out scenario never reaches an agent, and nothing published names the machine's temp folder
  const published = filesUnder(out);
  expect(published.filter((f) => f.endsWith('prompt.md')).length).toBe(3);
  for (const f of published) {
    const text = readFileSync(f, 'utf8');
    expect(text.includes(SECRET), f).toBe(false);
    expect(text.includes(dir), f).toBe(false);
  }
  const costs = JSON.parse(readFileSync(join(out, 'costs.json'), 'utf8')) as { totalUsd: number };
  expect(costs.totalUsd).toBe(record.spendUsd);
  expect(record.spendUsd).toBeGreaterThanOrEqual(0.0019);
  expect(existsSync(join(out, 'tasks', task, 'diff.patch'))).toBe(true);
  expect(readFileSync(join(out, 'tasks', task, 'diff.patch'), 'utf8')).toContain(`src/lib/${task}.ts`);
}, 120_000);

test('the dry control is red at the end and never reaches the gate', async () => {
  const r = relay('fixture', '--control', '--dry');
  expect(r.code, r.err).toBe(0);
  const out = join(bench, 'fixture-control-dry');
  expect(await relayProblems(out)).toEqual([]);
  const { record, events } = await readPublished(out);
  expect(record.end).toBe('not-green');
  expect(record.gate).toBe(false);
  expect(record.hops.map((h) => h.verification)).toEqual(['red', 'red', 'red']);
  expect(record.outcome).toBe("stopped before the gate: the daemon's verification of r3 is red");
  expect((events.get(record.tasks[0] as string) ?? []).some((e) => e.type === 'approval.requested')).toBe(false);
}, 120_000);

test('--budget-usd stops before the first step once the published spend would pass it, and a published run is never replaced', async () => {
  const r = relay('fixture', '--dry', '--name', 'fixture-budget', '--budget-usd', '0.001');
  expect(r.code, r.err).toBe(0);
  const { record } = await readPublished(join(bench, 'fixture-budget'));
  expect(record.end).toBe('budget');
  expect(record.hops).toEqual([]);
  expect(record.outcome).toStartWith('stopped before muse-code: recorded spend $');
  expect(record.priorSpendUsd).toBeGreaterThan(0.001);
  const again = relay('fixture', '--dry');
  expect(again.code).toBe(2);
  expect(again.err).toContain('a published run is never replaced');
}, 120_000);

test('the check names a broken chain and a wrong agent order', async () => {
  const copy = join(dir, 'broken');
  cpSync(join(bench, 'fixture-dry'), copy, { recursive: true });
  const record = JSON.parse(readFileSync(join(copy, 'relay.json'), 'utf8')) as { tasks: string[]; hops: Array<{ adapter: string }> };
  const log = join(copy, 'tasks', record.tasks[0] as string, 'events.jsonl');
  writeFileSync(log, readFileSync(log, 'utf8').replace('"type":"run.started"', '"type":"run.started","note":"x"').replace('"role":"implementer"', '"role":"reviewer"'));
  record.hops.reverse();
  writeFileSync(join(copy, 'relay.json'), JSON.stringify(record));
  const problems = await relayProblems(copy);
  expect(problems.some((p) => p.includes('hash chain breaks at row'))).toBe(true);
  expect(problems).toContain('the agents ran as codex > claude-code > muse-code, not muse-code > claude-code > codex');
}, 30_000);

test('every relay published under bench/relay holds up', async () => {
  const published = join(root, 'bench', 'relay');
  for (const d of readdirSync(published, { withFileTypes: true })) {
    if (d.isDirectory() && existsSync(join(published, d.name, 'relay.json'))) expect(await relayProblems(join(published, d.name))).toEqual([]);
  }
});

test('the live config runs Claude Code on Glimmer through Ollama and Codex on Muse Spark 1.3 through the Meta Model API, with no other credential', () => {
  const repo = { id: 'r', name: 'o/r', url: 'u', licence: 'MIT', commit: 'c'.repeat(40), install: 'true', testCommand: 'npm test', removeInBaseline: [] };
  const config = relayConfig(repo, '/scenarios', null);
  const claude = config.agents?.['claude-code'];
  const codex = config.agents?.codex;
  expect([claude?.enabled, claude?.harness, claude?.model, claude?.host, claude?.env]).toEqual([true, 'claude-code', 'muse-glimmer:30b-mlx', 'ollama', []]);
  expect([codex?.enabled, codex?.harness, codex?.model, codex?.host, codex?.env]).toEqual([true, 'codex', 'muse-spark-1.3', 'meta-api', ['META_API_KEY']]);
  expect(config.adapters['muse-code']?.model).toBe('muse-spark-1.3');
  expect(config.routes.reviewer).toEqual(['ollama/muse-glimmer:30b-mlx']);
  expect(config.routes.summary).toEqual(['ollama/muse-glimmer:30b-mlx']);
  expect(config.verify).toEqual({ checks: [], tamper: 'fail' });
  expect(config.scenarios).toEqual({ dir: '/scenarios', command: 'npm test' });
  expect(config.testCommand).toBe('npm test');
});

test('a live run refuses an ANTHROPIC_BASE_URL that is not Ollama', () => {
  expect(liveEnvProblem({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' })).toBe('ANTHROPIC_BASE_URL is https://api.anthropic.com; unset it so Claude Code runs on Glimmer through Ollama');
  expect(liveEnvProblem({ ANTHROPIC_BASE_URL: 'http://localhost:11434' })).toBeNull();
  expect(liveEnvProblem({})).toBeNull();
});

test('a dry learning sequence turns a repeated finding into a skill the script approves, and later tasks run with it', async () => {
  const r = relay('fixture', '--learning', '--dry');
  expect(r.code, r.err).toBe(0);
  const out = join(bench, 'fixture-learning-dry');
  expect(await relayProblems(out)).toEqual([]);
  const { record } = await readPublished(out);
  expect(record.end).toBe('sequence-done');
  expect(record.steps.map((s) => [s.verification, s.review?.verdict, s.approvedBy, s.learn, s.skillApproved, s.skillsMounted])).toEqual([
    ['green', 'request_changes', SCRIPTED_BY, 'skipped: no recurrence', null, []],
    ['green', 'request_changes', SCRIPTED_BY, 'proposed limits-come-from-config', 'limits-come-from-config', []],
    ...[3, 4, 5, 6].map(() => ['green', 'request_changes', SCRIPTED_BY, expect.any(String), null, ['limits-come-from-config']]),
  ]);
  expect(existsSync(join(out, 'skills', 'limits-come-from-config', 'SKILL.md'))).toBe(true);
}, 180_000);
