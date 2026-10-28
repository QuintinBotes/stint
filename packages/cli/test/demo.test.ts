import { expect, test } from 'bun:test';
import { join } from 'node:path';

const bin = join(import.meta.dir, '..', 'bin', 'stint');
const run = (args: string[]) => Bun.spawnSync(['bun', bin, ...args], { stdout: 'pipe', stderr: 'pipe' });
const jsonLines = (out: Buffer) => out.toString().trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

test('stint demo --from 1:05 emits the kill as its first non-header event', () => {
  const r = run(['demo', '--from', '1:05', '--speed', '0', '--json']);
  expect(r.exitCode).toBe(0);
  const [header, first, second] = jsonLines(r.stdout);
  expect(header?.version).toBe('stint.recording/1');
  expect(first).toMatchObject({ at: '1:05', type: 'human.command', beat: 'Kill it' });
  expect(String(first?.command)).toContain('pkill -9');
  expect(second).toMatchObject({ type: 'run.finished', run: 'r2', endedBy: 'killed' });
}, 60_000);

test('stint demo --speed 0 --json ends with a summary line and exits 0 without keys', () => {
  const env = { ...process.env, META_API_KEY: '', BASETEN_API_KEY: '', FIREWORKS_API_KEY: '' };
  const r = Bun.spawnSync(['bun', bin, 'demo', '--speed', '0', '--json'], { stdout: 'pipe', stderr: 'pipe', env });
  expect(r.exitCode).toBe(0);
  const last = jsonLines(r.stdout).at(-1);
  expect(last).toMatchObject({ done: true, lastAt: '2:35' });
  expect(last?.tasks).toContainEqual({ id: 'T-0042', status: 'done', usd: 0.6253 });
}, 60_000);
