import { expect, test } from 'bun:test';
import { Workspace } from '@stint-dev/core/node';
import { DEFAULT_RECORDING, Replayer, createApp } from '../src/index';
import { TOKEN, withFixtureRepo } from './helpers';

test('The relay of the replayed story puts each run on its agent lane, links the killed run to the run that continued from its packet, and the skill from T-0042 into T-0043', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const r = new Replayer(ws);
    await r.load(DEFAULT_RECORDING);
    await r.play({ speed: 0 });
    const app = createApp(ws, [], { token: TOKEN, quiet: true, webDist: null });
    const relay = (await (await app.request('/api/relay')).json()) as {
      lanes: Array<{ id: string; human: boolean }>;
      runs: Array<{ task: string; run: string; lane: string; endedBy: string | null }>;
      links: Array<Record<string, unknown>>;
      marks: Array<{ kind: string; task: string }>;
      replay: boolean;
    };
    expect(relay.lanes.map((l) => l.id)).toEqual(['meta-api/muse-wonder-1.0', 'muse-code:muse-spark-1.3', 'stint-agent:muse-spark-1.3', 'ollama/muse-glimmer:30b-mlx', 'you']);
    expect(relay.runs.find((x) => x.task === 'T-0042' && x.run === 'r2')).toMatchObject({ lane: 'muse-code:muse-spark-1.3', endedBy: 'killed' });
    expect(relay.links).toContainEqual(expect.objectContaining({ kind: 'packet', task: 'T-0042', from: 'r2', to: 'r3', tokens: 412 }));
    expect(relay.links).toContainEqual(expect.objectContaining({ kind: 'skill', skill: 'limiter-config-via-env', fromTask: 'T-0042', from: 'r4', toTask: 'T-0043', to: 'r1' }));
    expect(relay.marks).toContainEqual(expect.objectContaining({ kind: 'approved', task: 'T-0042' }));
    expect(relay.replay).toBe(true);
  });
}, 60_000);
