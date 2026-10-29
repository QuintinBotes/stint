import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Task } from '@stint-dev/core';
import type { VerificationCheck, VerificationRecord, Workspace } from '@stint-dev/core/node';
import { checkTamperAtRef, readTestsLock, tamperMode, type TamperResult } from './acceptance';
import { runEnv } from './env';
import { git, gitOk } from './git';
import { listScenarioFiles, scenariosDir } from './scenarios';
import { checkVisual } from './visual';
import { installDependencies } from './worktree';

export interface Verifier {
  verify(task: Task, run: string, worktree: string): Promise<VerificationRecord>;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/** Vitest (`Tests  1 failed | 26 passed (27)`) and bun test (` 26 pass`, ` 1 fail`) summaries; null when neither is there. */
export function parseTestSummary(output: string): { passed: number; failed: number } | null {
  const text = output.replace(ANSI, '');
  const vitest = /^\s*Tests\s+(.*)$/m.exec(text);
  if (vitest?.[1] && /\d+ (passed|failed)/.test(vitest[1])) {
    const passed = Number(/(\d+) passed/.exec(vitest[1])?.[1] ?? 0);
    const failed = Number(/(\d+) failed/.exec(vitest[1])?.[1] ?? 0);
    return { passed, failed };
  }
  const pass = /^\s*(\d+) pass\s*$/m.exec(text);
  const fail = /^\s*(\d+) fail\s*$/m.exec(text);
  if (pass || fail) return { passed: Number(pass?.[1] ?? 0), failed: Number(fail?.[1] ?? 0) };
  return null;
}

/** The names of failing tests: bun's "(fail) name" lines and Vitest's "FAIL file > name" or "× name" lines. */
export function failingTests(output: string): string[] {
  const text = output.replace(ANSI, '');
  const names = new Set<string>();
  for (const m of text.matchAll(/^\s*\(fail\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/gm)) names.add((m[1] as string).trim());
  for (const m of text.matchAll(/^\s*(?:FAIL|×|✗)\s+(.+?)(?:\s+\d+m?s)?\s*$/gm)) names.add((m[1] as string).trim());
  return [...names].slice(0, 20).map((n) => n.slice(0, 200));
}

/** The first line that says the tests could not even load: a test that never ran cannot fail for the right reason. */
export function loadError(output: string): string | null {
  const m = /^.*(SyntaxError|Cannot find module|Could not resolve|Module not found|Cannot find package|Unexpected token).*$/m.exec(output.replace(ANSI, ''));
  return m ? m[0].trim().slice(0, 200) : null;
}

/** The line-coverage percentage of a runner's summary: istanbul's `Lines : N%`, or the Lines column of the `All files` row. */
export function parseCoverage(output: string): number | null {
  const text = output.replace(ANSI, '');
  const lines = /^\s*Lines\s*:\s*([\d.]+)\s*%/m.exec(text);
  if (lines?.[1]) return Number(lines[1]);
  const rows = text.split('\n');
  const all = rows.find((l) => /^\s*All files\b/.test(l));
  if (!all) return null;
  const numbers = [...all.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (numbers.length === 0) return null;
  const header = rows.find((l) => l.includes('%') && /Lines/.test(l));
  if (header) {
    const columns = header.split('|').map((c) => c.trim());
    const percentColumns = columns.filter((c) => c.startsWith('%'));
    const at = percentColumns.findIndex((c) => /Lines/.test(c));
    if (at >= 0 && numbers[at] !== undefined) return numbers[at] as number;
  }
  return numbers.at(-1) ?? null;
}

type Exec = { exitCode: number; output: string; durationMs: number; timedOut: boolean };
type Prepared = { env: Record<string, string>; wrap?: (argv: string[]) => string[] };

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 512 * 1024;

/**
 * Runs a shell command in its own process group so a cap kills the whole tree. The cap counts time the machine
 * was awake: a laptop that sleeps mid-test fires the timer on waking, while `now` (performance.now) stood still,
 * so the timer is set again for the awake time still owed instead of failing a test that never ran over.
 */
export function execInGroup(command: string, cwd: string, env: Record<string, string>, capMs: number, now: () => number = () => performance.now(), wrap: (argv: string[]) => string[] = (a) => a): Promise<Exec> {
  return new Promise((resolve) => {
    const t0 = now();
    const [bin, ...args] = wrap(['/bin/sh', '-c', command]) as [string, ...string[]];
    const child = spawn(bin, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // a head and a tail: the summary and the failing names a runner prints are at the end, and the memory stays bounded
    let head = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let dropped = 0;
    const keep = (b: Buffer) => {
      if (head.length < HEAD_BYTES) {
        const n = Math.min(HEAD_BYTES - head.length, b.length);
        head = Buffer.concat([head, b.subarray(0, n)]);
        b = b.subarray(n);
      }
      if (b.length === 0) return;
      tail = Buffer.concat([tail, b]);
      if (tail.length > TAIL_BYTES * 2) {
        dropped += tail.length - TAIL_BYTES;
        tail = tail.subarray(tail.length - TAIL_BYTES);
      }
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const arm = (ms: number): ReturnType<typeof setTimeout> =>
      setTimeout(() => {
        const awake = now() - t0;
        if (awake < capMs - 50) {
          timer = arm(capMs - awake);
          return;
        }
        timedOut = true;
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }, ms);
    let timer = arm(capMs);
    // a command that cannot start (its folder is gone) is a red result, never an uncaught error that ends the daemon
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, output: `stint: the command could not start: ${err.message}\n`, durationMs: Math.round(now() - t0), timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (tail.length > TAIL_BYTES) {
        dropped += tail.length - TAIL_BYTES;
        tail = tail.subarray(tail.length - TAIL_BYTES);
      }
      const marker = dropped ? Buffer.from(`\n[stint: ${dropped} bytes of output were left out here]\n`) : Buffer.alloc(0);
      resolve({ exitCode: code ?? 1, output: Buffer.concat([head, marker, tail]).toString('utf8'), durationMs: Math.round(now() - t0), timedOut });
    });
  });
}

const RUNNER = /(^|\s)(bun\s+test|bun\s+run\s+test|bunx\s+vitest|npx\s+vitest|vitest|npm\s+(run\s+)?test|yarn\s+test|pnpm\s+(run\s+)?test)(\s|$)/;
const SHELL_OPS = /[;&|`]|\$\(|>/;
const quote = (p: string) => `'${p.replaceAll("'", `'\\''`)}'`;

/** The test command asking for coverage, when the runner is bun or Vitest (R-037); null when it is neither. */
export function coverageCommand(testCommand: string): string | null {
  if (testCommand.includes('--coverage')) return testCommand;
  if (!RUNNER.test(testCommand) || SHELL_OPS.test(testCommand)) return null;
  return `${testCommand} --coverage`;
}

type ScenarioOutcome = {
  record: { passed: number; failed: number; names: string[] } | null;
  failing: string[];
  error?: string;
};

type CoverageOutcome = { coverage: { base: number | null; branch: number | null } | null; reason?: string };

/** The daemon runs the tests itself; an agent saying "tests pass" is a claim, this record is the fact. */
export class DaemonVerifier implements Verifier {
  /** The environment and sandbox a test run gets, as an agent run would (R-040); unset, a plain stripped environment. */
  prepare?: (task: string, run: string, dir: string, extra: Record<string, string>) => Promise<Prepared>;

  constructor(
    private readonly ws: Workspace,
    private readonly capMs = 10 * 60_000,
  ) {}

  /** What a command run on the task's code gets: the run's sandbox when one is configured. */
  private async prepared(task: Task, run: string, dir: string): Promise<Prepared> {
    const extra = { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
    return this.prepare ? this.prepare(task.id, run, dir, extra) : { env: { ...runEnv(task.id, run, dir, { hosts: this.ws.config.hosts }), ...extra } };
  }

  /** Runs one command of the suite on the task's code. */
  private async exec(task: Task, run: string, command: string, dir: string): Promise<Exec> {
    const p = await this.prepared(task, run, dir);
    return execInGroup(command, dir, p.env, this.capMs, undefined, p.wrap);
  }

  async verify(task: Task, run: string, worktree: string): Promise<VerificationRecord> {
    const defs = [
      { name: 'tests', command: task.testCommand, kind: 'test' as const },
      ...(task.checks ?? this.ws.config.verify?.checks ?? []),
    ];
    const checks: VerificationCheck[] = [];
    const outputs: string[] = [];
    let tests: Exec | null = null;
    let testsParsed: { passed: number; failed: number } | null = null;
    let testsTimedOut = false;
    for (const def of defs) {
      const r = await this.exec(task, run, def.command, worktree);
      outputs.push(r.output);
      const isTests = def.name === 'tests' && def.command === task.testCommand && tests === null;
      if (isTests) {
        tests = r;
        testsTimedOut = r.timedOut;
      }
      const parsed = def.kind === 'test' ? parseTestSummary(r.output) : null;
      if (isTests) testsParsed = parsed;
      const ok = r.exitCode === 0 && !r.timedOut;
      const counts = def.kind === 'test' ? (parsed ?? { passed: ok ? 1 : 0, failed: ok ? 0 : 1 }) : null;
      checks.push({
        name: def.name,
        kind: def.kind,
        exitCode: r.timedOut ? 124 : r.exitCode,
        ...(counts ? { passed: counts.passed, failed: counts.failed } : {}),
        durationMs: r.durationMs,
        status: ok && (counts === null || counts.failed === 0) ? 'green' : 'red',
      });
    }
    const testsCheck = checks[0] as VerificationCheck;
    const counts = { passed: testsCheck.passed ?? 0, failed: testsCheck.failed ?? 0 };
    const testsOutput = outputs[0] ?? '';

    const tamper = await this.tamper(task, run, worktree);
    const tamperRed = !!tamper && !tamper.allowedBy && tamperMode(this.ws) === 'fail';
    const scenarios = await this.runScenarios(task, run, worktree);
    // scenarios that could not run proved nothing, so they hold the verification red as a failing one would (R-037)
    const scenariosRed = scenarios.error !== undefined || (scenarios.record !== null && scenarios.record.failed > 0);
    const coverage = await this.coverage(task, run, worktree);

    const testsGreen = checks.every((c) => c.status === 'green') && !tamperRed && !scenariosRed;
    // once the tests pass, what a person would see (R-068): each check that did not hold is a reason
    const looked = testsGreen ? await checkVisual(this.ws, task, run, worktree, await this.prepared(task, run, worktree)) : [];
    const green = testsGreen && looked.length === 0;
    const reason = tamperRed ? 'tampered' : scenariosRed ? 'scenarios' : looked.length ? looked.join('; ') : undefined;
    const store = this.ws.verification(task.id);
    const extra = defs.slice(1).map((d, i) => `\n=== check: ${d.name} (${d.kind}): ${d.command} ===\n${outputs[i + 1] ?? ''}`);
    const scenarioLine = scenarios.record
      ? `\n=== held-out scenarios: ${scenarios.record.passed} passed, ${scenarios.record.failed} failed (${scenarios.record.names.join(', ')}) ===\n`
      : scenarios.error
        ? `\n=== held-out scenarios were NOT run: ${scenarios.error} ===\n`
        : '';
    const outputRef = await store.writeOutput(run, testsOutput + extra.join('') + scenarioLine);
    const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
    const record = await store.write({
      run,
      command: task.testCommand,
      exitCode: testsCheck.exitCode,
      passed: counts.passed,
      failed: counts.failed,
      durationMs: checks.reduce((sum, c) => sum + c.durationMs, 0),
      runBy: 'daemon',
      status: green ? 'green' : 'red',
      outputRef,
      at: new Date().toISOString(),
      ...(testsTimedOut ? { timedOut: true } : {}),
      ...(/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(head) ? { commit: head } : {}),
      ...(reason ? { reason } : {}),
      checks,
      ...(tamper !== undefined ? { tamper } : {}),
      scenarios: scenarios.record,
      coverage: coverage.coverage,
      ...(coverage.reason ? { coverageReason: coverage.reason } : {}),
    });
    await this.ws.events(task.id).append({
      task: task.id,
      run,
      vendor: 'daemon',
      type: 'verification.ran',
      payload: {
        command: record.command,
        exitCode: record.exitCode,
        passed: record.passed,
        failed: record.failed,
        durationMs: record.durationMs,
        status: record.status,
        runBy: 'daemon',
        parsed: testsParsed !== null,
        failing: failingTests(testsOutput),
        checks: record.checks,
        ...(record.tamper !== undefined ? { tamper: record.tamper } : {}),
        scenarios: record.scenarios,
        coverage: record.coverage,
        ...(record.reason ? { reason: record.reason } : {}),
        ...(coverage.reason ? { coverageReason: coverage.reason } : {}),
        ...(scenarios.failing.length ? { scenarioFailing: scenarios.failing } : {}),
        ...(scenarios.error ? { scenariosError: scenarios.error } : {}),
        ...(loadError(testsOutput) ? { loadError: loadError(testsOutput) } : {}),
        ...(testsTimedOut ? { timedOut: true } : {}),
      },
    });
    return record;
  }

  /**
   * Locked test files that changed on the branch this worktree has checked out (R-029): null when none did.
   * Undefined when nothing is locked or the check is off, so "tests unchanged" never claims a lock that does not exist.
   */
  private async tamper(task: Task, run: string, worktree: string): Promise<TamperResult | null | undefined> {
    if (tamperMode(this.ws) === 'off' || (await readTestsLock(this.ws, task.id)).length === 0) return undefined;
    if ((await git(worktree, ['rev-parse', '--verify', '-q', 'HEAD'])).code === 0) {
      return checkTamperAtRef(this.ws, task.id, run, worktree, 'HEAD');
    }
    if ((await git(this.ws.root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).code === 0) {
      return checkTamperAtRef(this.ws, task.id, run, this.ws.root, task.branch);
    }
    return null;
  }

  /**
   * Held-out scenarios (R-037): copied into a temporary checkout of the task branch, never the agent's
   * worktree. Only counts and names come back; the scenario output and source are never written anywhere.
   */
  private async runScenarios(task: Task, run: string, worktree: string): Promise<ScenarioOutcome> {
    const dir = scenariosDir(this.ws, task.id);
    const files = await listScenarioFiles(dir);
    if (files.length === 0) return { record: null, failing: [] };
    const head =
      (await git(this.ws.root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).stdout.trim() ||
      (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
    const path = join(this.ws.cacheDir, 'verify', `${task.id}-${Date.now()}-scenarios`);
    try {
      if (!head) throw new Error(`${task.branch} does not exist`);
      await mkdir(join(this.ws.cacheDir, 'verify'), { recursive: true });
      await gitOk(this.ws.root, ['worktree', 'add', '-q', '--detach', path, head]);
      try {
        await installDependencies(path);
        for (const file of files) {
          const target = join(path, file);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, await readFile(join(dir, file)));
        }
        const configured = this.ws.config.scenarios?.command;
        const command = configured
          ? configured.includes('{files}')
            ? configured.replaceAll('{files}', files.map(quote).join(' '))
            : configured
          : RUNNER.test(task.testCommand) && !SHELL_OPS.test(task.testCommand)
            ? `${task.testCommand} ${files.map(quote).join(' ')}`
            : task.testCommand;
        const r = await this.exec(task, run, command, path);
        const ok = r.exitCode === 0 && !r.timedOut;
        const counts = parseTestSummary(r.output) ?? { passed: ok ? 1 : 0, failed: ok ? 0 : 1 };
        const failing = failingTests(r.output);
        const record = { passed: counts.passed, failed: counts.failed, names: [...new Set([...files, ...failing])] };
        await this.ws.events(task.id).append({ task: task.id, run, vendor: 'daemon', type: 'scenario.ran', payload: { run, ...record, failing } });
        return { record, failing };
      } finally {
        await git(this.ws.root, ['worktree', 'remove', '--force', path]);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: `held-out scenarios for ${task.id} were NOT run: ${error}` })}\n`);
      await this.ws.events(task.id).append({ task: task.id, run, vendor: 'daemon', type: 'scenario.ran', payload: { run, passed: 0, failed: 0, names: files, error } }).catch(() => undefined);
      return { record: null, failing: [], error };
    }
  }

  /** The coverage delta (R-037): the same command with --coverage on the branch worktree and on a checkout of the base. */
  private async coverage(task: Task, run: string, worktree: string): Promise<CoverageOutcome> {
    if (!this.ws.config.verify?.coverage) return { coverage: null };
    const command = coverageCommand(task.testCommand);
    if (!command) return { coverage: null, reason: 'the test command is not a bun or Vitest run, so no coverage was run' };
    try {
      const inWorktree = async (dir: string) => parseCoverage((await this.exec(task, run, command, dir)).output);
      const branch = await inWorktree(worktree);
      let base: number | null = null;
      const path = join(this.ws.cacheDir, 'verify', `${task.id}-${Date.now()}-coverage-base`);
      await mkdir(join(this.ws.cacheDir, 'verify'), { recursive: true });
      await gitOk(this.ws.root, ['worktree', 'add', '-q', '--detach', path, task.baseCommit]);
      try {
        await installDependencies(path);
        base = await inWorktree(path);
      } finally {
        await git(this.ws.root, ['worktree', 'remove', '--force', path]);
      }
      if (base === null && branch === null) return { coverage: null, reason: 'the runner gave no coverage summary' };
      const missing = base === null ? 'the base commit' : branch === null ? 'the branch' : null;
      return { coverage: { base, branch }, ...(missing ? { reason: `the runner gave no coverage summary on ${missing}` } : {}) };
    } catch (err) {
      const reason = `coverage could not run: ${err instanceof Error ? err.message : String(err)}`;
      process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: `coverage for ${task.id} was NOT run: ${reason}` })}\n`);
      return { coverage: null, reason };
    }
  }
}
