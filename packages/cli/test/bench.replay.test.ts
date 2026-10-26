import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { createApp } from '@stint-dev/daemon';
import { tempDir } from '../../core/test/fixture';
import type { BenchResults } from '../src/bench/results';
import { renderTranscript } from '../src/bench/transcript';

const bin = join(import.meta.dir, '..', 'bin', 'stint');
const fixtures = join(import.meta.dir, 'fixtures', 'bench-runs');
const repoRoot = join(import.meta.dir, '..', '..', '..');

/** Runs the replay in a temp repository root, so results land in <root>/bench and the checkout stays clean. */
function replay(cwd: string, extra: string[] = []) {
  return Bun.spawnSync(['bun', bin, 'bench', '--replay', '--from', fixtures, '--tasks', '2', '--modes', 'transcript,packet', ...extra], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

test('stint bench --replay --tasks 2 --modes transcript,packet writes results.json validating against the shape and an SVG with two groups', async () => {
  const tmp = tempDir('stint-bench-');
  try {
    const r = replay(tmp.dir);
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    const out = r.stdout.toString();
    expect(out).toContain('transcript');
    expect(out).toContain('packet');
    expect(out).toContain('Ratio (transcript over packet mean input tokens)');

    const resultsPath = join(tmp.dir, 'bench', 'results.json');
    expect(existsSync(resultsPath)).toBe(true);
    const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as BenchResults;
    expect(results.version).toBe('stint.bench/1');
    expect(results.replay).toBe(true);
    expect(results.synthetic).toBe(true);
    expect(results.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(new Date(results.startedAt).toString()).not.toBe('Invalid Date');
    expect(new Date(results.finishedAt).toString()).not.toBe('Invalid Date');
    expect(results.implementer).toBe('muse-code');
    expect(results.continuer).toBe('stint-agent');
    expect(results.models['stint-agent']).toBe('muse-spark-1.3');
    expect(results.rows).toHaveLength(4);
    for (const row of results.rows) {
      expect(['bench-01-rate-limit', 'bench-02-get-event']).toContain(row.task);
      expect(['transcript', 'packet']).toContain(row.mode);
      expect(row.host.length).toBeGreaterThan(0);
      expect(row.model.length).toBeGreaterThan(0);
      for (const n of [row.inputTokens, row.cachedTokens, row.outputTokens, row.wallMs, row.promptTokens]) {
        expect(Number.isFinite(n) && n >= 0).toBe(true);
      }
      expect(row.usd === null || (typeof row.usd === 'number' && row.usd >= 0)).toBe(true);
      expect(typeof row.verified).toBe('boolean');
      expect(row.synthetic).toBe(true);
    }
    for (const mode of ['transcript', 'packet'] as const) {
      const m = results.byMode[mode];
      expect(m?.runs).toBe(2);
      expect(m?.meanInputTokens).toBeGreaterThan(0);
      expect(m?.meanPromptTokens).toBeGreaterThan(0);
      expect(m?.meanUsd).toBeGreaterThan(0);
      expect(m?.passRate).toBeGreaterThanOrEqual(0);
      expect(m?.passRate).toBeLessThanOrEqual(1);
    }
    expect(results.ratio).toBeGreaterThan(0);

    const dark = readFileSync(join(tmp.dir, 'bench', 'results.svg'), 'utf8');
    const light = readFileSync(join(tmp.dir, 'bench', 'results-light.svg'), 'utf8');
    for (const svg of [dark, light]) {
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.match(/class="group"/g)).toHaveLength(2);
      expect(svg).toContain('data-task="bench-01-rate-limit"');
      expect(svg).toContain('data-task="bench-02-get-event"');
      expect(svg).toContain('passed');
    }
    expect(dark).toContain('#0b0b0d');
    expect(light).toContain('#ffffff');

    // The daemon serves the same file for the Factory view, and says not_found where there is none.
    const app = createApp(await Workspace.open(tmp.dir), [], { token: 'bench-test-token', quiet: true, webDist: null });
    const served = await app.request('/api/bench');
    expect(served.status).toBe(200);
    expect(((await served.json()) as BenchResults).version).toBe('stint.bench/1');
    const empty = tempDir('stint-bench-empty-');
    try {
      const emptyApp = createApp(await Workspace.open(empty.dir), [], { token: 'bench-test-token', quiet: true, webDist: null });
      const missing = await emptyApp.request('/api/bench');
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('not_found');
    } finally {
      empty.cleanup();
    }
  } finally {
    tmp.cleanup();
  }
});

test('The transcript-mode prompt token count is larger than the packet-mode one for the recorded runs, and both are reported', () => {
  const tmp = tempDir('stint-bench-');
  try {
    const r = replay(tmp.dir, ['--json']);
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    const results = JSON.parse(r.stdout.toString()) as BenchResults;
    const transcript = results.byMode.transcript;
    const packet = results.byMode.packet;
    expect(transcript?.meanPromptTokens).toBeGreaterThan(0);
    expect(packet?.meanPromptTokens).toBeGreaterThan(0);
    expect(transcript?.meanPromptTokens ?? 0).toBeGreaterThan(packet?.meanPromptTokens ?? 0);
    for (const task of ['bench-01-rate-limit', 'bench-02-get-event']) {
      const t = results.rows.find((row) => row.task === task && row.mode === 'transcript');
      const p = results.rows.find((row) => row.task === task && row.mode === 'packet');
      expect(t?.promptTokens ?? 0).toBeGreaterThan(p?.promptTokens ?? 0);
    }
  } finally {
    tmp.cleanup();
  }
});

test('renderTranscript turns Muse Code MSP lines and Stint agent response lines into messages, tool calls and tool results', () => {
  const muse = renderTranscript(readFileSync(join(repoRoot, 'packages/adapters/muse-code/test/fixtures/exec-run.jsonl'), 'utf8').split('\n'));
  expect(muse).toContain('User: Add a test file test/health.test.ts');
  expect(muse).toContain('Tool call: read_file');
  expect(muse).toContain('"path": "test/helpers.ts"');
  expect(muse).toContain('Tool result (read_file):');
  expect(muse).toContain('Assistant: Done. Added');
  expect(muse).toContain('[tool result truncated at 4 KB]');

  const stint = renderTranscript(readFileSync(join(repoRoot, 'packages/adapters/stint-agent/test/fixtures/continue-run.jsonl'), 'utf8').split('\n'));
  expect(stint).toContain('Assistant: Starting rate-limit work');
  expect(stint).toContain('Tool call: list_dir');
  expect(stint).toContain('"path": "src"');
  expect(stint).toContain('Tool call: bash');
  expect(stint).toContain('git log --oneline -10');
});

test('published bench artefacts carry no local paths: the fixture folder, the home directory and cut-off temp paths become placeholders', async () => {
  const { homedir } = await import('node:os');
  const { scrubPaths } = await import('../src/bench/live');
  const text = `cd /private/var/folders/vm/abc123/T/stint-demo-Xy12/.stint/worktrees/T-0001-r1 && cat ${homedir()}/.local/share/muse/sessions/x.jsonl; see [file](/private/var/f`;
  expect(scrubPaths(text)).toBe('cd <fixture>/.stint/worktrees/T-0001-r1 && cat ~/.local/share/muse/sessions/x.jsonl; see [file](<tmp>');
});

test('the scrub also removes the user name, JSON-escaped and URL-encoded home paths, and secret values from the environment', async () => {
  const { homedir, userInfo } = await import('node:os');
  const { scrubPaths } = await import('../src/bench/live');
  process.env.STINT_TEST_API_KEY = 'sk-test-0123456789';
  try {
    const home = homedir();
    const text = `owner ${userInfo().username} staff; {"cwd":"${home.replaceAll('/', '\\/')}/x"}; open ${encodeURIComponent(home)}%2Fy; key sk-test-0123456789; META_API_KEY=abc123def`;
    const out = scrubPaths(text);
    expect(out).not.toContain(userInfo().username);
    expect(out).not.toContain('sk-test-0123456789');
    expect(out).toContain('owner user staff');
    expect(out).toContain('META_API_KEY=[redacted]');
  } finally {
    delete process.env.STINT_TEST_API_KEY;
  }
});
