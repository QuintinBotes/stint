import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, countTokens, renderHandoff } from '@stint-dev/core';
import { httpClient, runLiveBeats } from '../../cli/src/demo/live';
import { recordWorkspace } from '../../cli/src/demo/record';
import { seedDemo } from '../../cli/src/demo/seed';
import { type Adapter, Replayer, startDaemon } from '../src/index';
import { fakeModels } from './autopilot.fixtures';
import { makeApp, tempDir, withFixtureRepo } from './helpers';

const base = {
  vendor: 'meta' as const,
  roles: ['implementer'] as Array<'implementer'>,
  capabilities: { editsFiles: true, runsCommands: false, resumable: false, structuredOutput: false, offline: true },
  available: async () => ({ ok: true as const, version: 'fake 1' }),
  gate: () => 'none' as const,
};

/** Muse Code for the beats: on T-0042 it writes the limiter then waits to be killed; on T-0043 it completes. */
const museFake: Adapter = {
  ...base,
  id: 'muse-code',
  async run(ctx) {
    await ctx.emit({ type: 'agent.tool_call', payload: { tool: 'write_file', args: { path: 'src/lib/limiter.ts' }, callId: 'c1' } });
    if (ctx.task.id === 'T-0043') {
      await Bun.write(`${ctx.worktree}/src/lib/admin-limiter.ts`, 'export const ADMIN_LIMIT = 30;\n');
      await ctx.emit({ type: 'agent.message', payload: { text: 'Added the admin limiter constant.' } });
      return { endedBy: 'completed', cost: { inputTokens: 100, cachedTokens: 40, outputTokens: 20, usd: 0.001 } };
    }
    await Bun.write(`${ctx.worktree}/src/lib/limiter.ts`, 'export const LIMIT = 60;\n');
    await new Promise<void>((resolve) => {
      if (ctx.signal.aborted) resolve();
      else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return { endedBy: 'killed', cost: { inputTokens: 10, cachedTokens: 0, outputTokens: 2, usd: 0 }, inFlight: 'write_file src/lib/limiter.ts' };
  },
};

/** The Stint agent for the continue beat: it changes the limiter again and completes. */
const stintFake: Adapter = {
  ...base,
  id: 'stint-agent',
  async run(ctx) {
    await Bun.write(`${ctx.worktree}/src/lib/limiter.ts`, 'export const LIMIT = 60;\nexport const WINDOW_MS = 60_000;\n');
    await ctx.emit({ type: 'agent.message', payload: { text: 'Added the window to the limiter.' } });
    return { endedBy: 'completed', cost: { inputTokens: 100, cachedTokens: 40, outputTokens: 20, usd: 0.001 } };
  },
};

function writeFakeConfig(repo: string, modelsUrl: string): void {
  const config = structuredClone(DEFAULT_CONFIG);
  config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<typeof config.hosts.ollama>), baseURL: modelsUrl, models: { fake: 'fake' } };
  config.routes.planner = ['ollama/fake'];
  config.routes.reviewer = ['ollama/fake'];
  config.routes.learn = ['ollama/fake'];
  config.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
}

test('A live-shaped run recorded with stint demo record and replayed at speed 0 yields a T-0042 packet with the same hash and token count', async () => {
  const models = fakeModels();
  const tmp = tempDir('stint-fidelity-');
  try {
    let liveHash = '';
    let liveTokens = 0;
    const recording = join(tmp.dir, 'recording.jsonl');
    await withFixtureRepo(async (repo) => {
      writeFakeConfig(repo, models.url);
      await seedDemo(repo);
      const d = await startDaemon({ root: repo, quiet: true, adapters: [museFake, stintFake] });
      try {
        const summary = await runLiveBeats({
          client: httpClient(d.url, d.token),
          auto: true,
          allowOnline: true,
          isOnline: async () => false,
          killAfterSeconds: 0,
          timeoutMs: 180_000,
          out: () => undefined,
        });
        expect(summary.packet?.run).toBe('r2');
        expect(summary.packet?.endedBy).toBe('killed');
        const names = await d.ws.handoffs('T-0042').names();
        const packets = await Promise.all(names.map(async (n) => ({ name: n, packet: await d.ws.handoffs('T-0042').read(n) })));
        const fromR2 = packets.find((p) => p.packet?.from.run === 'r2');
        expect(fromR2?.packet?.from.endedBy).toBe('killed');
        liveHash = fromR2?.packet?.hash as string;
        liveTokens = countTokens(renderHandoff(fromR2?.packet as never));
        expect(liveTokens).toBeGreaterThan(0);
      } finally {
        await d.stop();
      }
      const recorded = await recordWorkspace({ repo, out: recording });
      expect(recorded.header.live).toBe(true);
      expect(recorded.events).toBeGreaterThan(20);
      expect(recorded.patches.length).toBeGreaterThan(0);
      for (const p of recorded.patches) expect(existsSync(join(tmp.dir, p))).toBe(true);
    });

    await withFixtureRepo(async (repo) => {
      const { ws } = await makeApp(repo);
      const r = new Replayer(ws);
      r.load(recording);
      expect(r.loaded?.header.live).toBe(true);
      const status = await r.play({ speed: 0 });
      expect(status.done).toBe(true);
      const names = await ws.handoffs('T-0042').names();
      const packets = await Promise.all(names.map((n) => ws.handoffs('T-0042').read(n)));
      const fromR2 = packets.find((p) => p?.from.run === 'r2');
      expect(fromR2?.hash).toBe(liveHash);
      expect(countTokens(renderHandoff(fromR2 as never))).toBe(liveTokens);
    });
  } finally {
    models.stop();
    tmp.cleanup();
  }
}, 300_000);
