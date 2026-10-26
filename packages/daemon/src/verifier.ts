import { spawn } from 'node:child_process';
import type { Task } from '@stint-dev/core';
import type { VerificationRecord, Workspace } from '@stint-dev/core/node';
import { runEnv } from './env';

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

type Exec = { exitCode: number; output: string; durationMs: number; timedOut: boolean };

/** Runs a shell command in its own process group so a cap kills the whole tree. */
export function execInGroup(command: string, cwd: string, env: Record<string, string>, capMs: number): Promise<Exec> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn('/bin/sh', ['-c', command], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.stderr.on('data', (b: Buffer) => chunks.push(b));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, capMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output: Buffer.concat(chunks).toString('utf8'), durationMs: Math.round(performance.now() - t0), timedOut });
    });
  });
}

/** The daemon runs the tests itself; an agent saying "tests pass" is a claim, this record is the fact. */
export class DaemonVerifier implements Verifier {
  constructor(
    private readonly ws: Workspace,
    private readonly capMs = 10 * 60_000,
  ) {}

  async verify(task: Task, run: string, worktree: string): Promise<VerificationRecord> {
    const env = { ...runEnv(task.id, run, worktree), CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
    const r = await execInGroup(task.testCommand, worktree, env, this.capMs);
    const parsed = parseTestSummary(r.output);
    const ok = r.exitCode === 0 && !r.timedOut;
    const counts = parsed ?? { passed: ok ? 1 : 0, failed: ok ? 0 : 1 };
    const store = this.ws.verification(task.id);
    const outputRef = await store.writeOutput(run, r.output);
    const record = await store.write({
      run,
      command: task.testCommand,
      exitCode: r.timedOut ? 124 : r.exitCode,
      passed: counts.passed,
      failed: counts.failed,
      durationMs: r.durationMs,
      runBy: 'daemon',
      status: ok && counts.failed === 0 ? 'green' : 'red',
      outputRef,
      at: new Date().toISOString(),
      ...(r.timedOut ? { timedOut: true } : {}),
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
        parsed: parsed !== null,
        failing: failingTests(r.output),
        ...(r.timedOut ? { timedOut: true } : {}),
      },
    });
    return record;
  }
}
