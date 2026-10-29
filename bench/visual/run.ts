// One live visual check (R-068 Acceptance 4): the fixture's admin page, seeded with a banner that says NaN s, verified
// by the daemon's own verifier against the Meta Model API. This spends money: one Muse Spark call and one SAM 3.1 call.
// Usage, from the repository root: bun bench/visual/run.ts [--keys <repo whose .env holds META_API_KEY>] [--port 6420]
// It writes bench/visual/result.json and the screenshot, the marked copy and the clip beside it.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Config, DEFAULT_CONFIG, type StintEvent } from '../../packages/core/src/index';
import { Workspace, applyKeys } from '../../packages/core/src/node';
import { DaemonVerifier, RunRegistry, Worktrees } from '../../packages/daemon/src/index';

const { values } = parseArgs({ options: { keys: { type: 'string' }, port: { type: 'string', default: '6420' } } });
const here = import.meta.dir;
applyKeys(values.keys ?? join(here, '..', '..'));
if (!process.env.META_API_KEY) throw new Error('META_API_KEY is not set; pass --keys <repo> or run stint keys set META_API_KEY');

const CRITERION = 'The admin page tells an over-limit tenant when to try again';
const REF = '/admin :: a 429 banner saying try again in 60 s';
const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(['git', ...args], { cwd, stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
};

const repo = mkdtempSync(join(tmpdir(), 'stint-visual-bench-'));
try {
  cpSync(join(here, 'fixture'), repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.name', 'Stint Bench'], ['user.email', 'bench@example.com'], ['commit.gpgsign', 'false']]) git(repo, 'config', k as string, v as string);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'The webhooks admin page');
  const config: Config = structuredClone(DEFAULT_CONFIG);
  config.visual = { serve: `bun serve.ts ${values.port} site`, url: `http://127.0.0.1:${values.port}` };
  await Bun.write(join(repo, '.stint', 'config.json'), JSON.stringify(config, null, 2));

  const ws = await Workspace.open(repo);
  const created = await ws.createTask({ title: 'Tell an over-limit tenant when to try again', goal: 'Show the retry time on the admin page.', acceptance: [CRITERION], testCommand: `printf ' 1 pass\\n 0 fail\\n'` });
  const task = await ws.writeTask(created.id, { proofs: [{ criterion: 1, kind: 'visual', ref: REF }] });
  const { path } = await new Worktrees(ws, new RunRegistry()).create(task, 'r1');
  const record = await new DaemonVerifier(ws).verify(task, 'r1', path);
  const check = (await ws.events(task.id).read()).find((e: StintEvent) => e.type === 'visual.checked')?.payload as Record<string, unknown> | undefined;
  if (!check) throw new Error('no visual check was recorded');

  const dir = await ws.taskDir(task.id);
  const files: Record<string, string> = {};
  for (const key of ['screenshot', 'marked', 'clip'] as const) {
    const rel = check[key];
    if (typeof rel !== 'string') continue;
    const name = rel.split('/').at(-1) as string;
    await copyFile(join(dir, rel), join(here, name));
    files[key] = `bench/visual/${name}`;
  }
  const result = {
    version: 'stint.visual-bench/1',
    at: new Date().toISOString(),
    live: true,
    page: REF,
    criterion: CRITERION,
    seeded: 'The banner says "Try again in NaN s." where it should say 60 s.',
    verification: { status: record.status, reason: record.reason ?? null },
    check: { ...check, ...files },
  };
  writeFileSync(join(here, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: record.status, holds: check.holds, element: check.element ?? null, marked: !!check.marked, usd: (check.cost as { usd?: number } | undefined)?.usd ?? null })}\n`);
} finally {
  rmSync(repo, { recursive: true, force: true });
}
