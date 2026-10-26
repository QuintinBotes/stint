import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { countTokens, renderHandoff } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';

const live = process.env.STINT_LIVE === '1';
const bin = join(import.meta.dir, '..', 'bin', 'stint');

test.skipIf(!live)(
  'With STINT_LIVE=1, keys present and Ollama up, stint demo --live --auto --allow-online completes every beat and the T-0042 packet from r2 is under 600 tokens with endedBy killed',
  async () => {
    const proc = Bun.spawn(['bun', bin, 'demo', '--live', '--auto', '--allow-online'], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(exitCode, stderr).toBe(0);
    const repo = /^Repo: (.+)$/m.exec(stdout)?.[1]?.trim();
    expect(repo, stdout).toBeTruthy();
    const ws = await Workspace.open(repo as string);
    expect((await ws.readTask('T-0042')).status).toBe('done');
    expect((await ws.readTask('T-0043')).status).toBe('awaiting_approval');
    const names = await ws.handoffs('T-0042').names();
    const packets = await Promise.all(names.map((n) => ws.handoffs('T-0042').read(n)));
    const fromR2 = packets.find((p) => p?.from.run === 'r2');
    expect(fromR2?.from.endedBy).toBe('killed');
    expect(countTokens(renderHandoff(fromR2 as never))).toBeLessThan(600);
    const types = (await ws.events('T-0042').read()).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['run.started', 'run.finished', 'verification.ran', 'handoff.created', 'review.recorded', 'approval.granted', 'merge.completed']));
  },
  45 * 60_000,
);

test.skipIf(live)('demo.live.test.ts skips without STINT_LIVE=1 (it needs META_API_KEY, Muse Code and Ollama); replay.fidelity is its CI twin', () => {
  expect(live).toBe(false);
});
