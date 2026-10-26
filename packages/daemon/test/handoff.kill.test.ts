import { describe, expect, test } from 'bun:test';
import { countTokens, renderHandoff } from '@stint-dev/core';
import { DEFAULT_RECORDING, Replayer, daemonContext, deriveHandoff, parseClock } from '../src/index';
import { makeApp, withFixtureRepo } from './helpers';

describe('the packet of a killed run', () => {
  test('On the replayed T-0042 log, buildHandoff after the killed r2 yields a packet that validates, is under 600 tokens, has endedBy killed, leftOut containing "In-flight step unknown", and askOfNext starting with "Check the unknown step first."', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo);
      const r = new Replayer(ws);
      r.load(DEFAULT_RECORDING);
      await r.play({ speed: 0, until: parseClock('1:07') });
      const ctx = daemonContext(app);
      const { handoff } = await deriveHandoff(ctx, 'T-0042', 'r2');
      expect(handoff.from).toMatchObject({ adapter: 'muse-code', run: 'r2', endedBy: 'killed' });
      expect(countTokens(renderHandoff(handoff))).toBeLessThan(600);
      expect(handoff.leftOut.some((l) => l.startsWith('In-flight step unknown'))).toBe(true);
      expect(handoff.askOfNext.startsWith('Check the unknown step first.')).toBe(true);
      expect(handoff.verification).toMatchObject({ passed: 30, failed: 0, runBy: 'daemon' });
      expect(handoff.decisions.map((d) => d.id)).toEqual(['D1', 'D2', 'D3']);
      expect(handoff.changedFiles.map((f) => f.path)).toContain('src/lib/limiter.ts');

      // The same packet's hash is stable across two builds and changes when events.jsonl gains a file.changed
      const again = await deriveHandoff(ctx, 'T-0042', 'r2');
      expect(again.handoff.hash).toBe(handoff.hash);
      await ws.events('T-0042').append({ task: 'T-0042', run: 'r2', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/lib/limiter.ts', added: 27, removed: 0, run: 'r2' } });
      expect((await deriveHandoff(ctx, 'T-0042', 'r2')).handoff.hash).not.toBe(handoff.hash);
    });
  }, 60_000);
});
