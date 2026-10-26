import { join } from 'node:path';
import { SkillProposalSchema, countTokens, renderHandoff } from '@stint-dev/core';
import { Workspace, readJsonIfExists } from '@stint-dev/core/node';
import { startDaemon } from '@stint-dev/daemon';
import { freshFixture } from '../demo';
import { recordEval } from '../eval';
import { runSkillEvalLive } from '../eval/live';
import { buildSkillEval, resolveSkillEvalTasks } from '../eval/results';
import { assertPreflight, type PreflightDeps } from './preflight';
import { seedDemo } from './seed';

/** The slice of daemon API the beats drive. Tests point it at a daemon with fake adapters. */
export type DemoClient = {
  post: (path: string, body: unknown) => Promise<unknown>;
  get: (path: string) => Promise<unknown>;
};

export function httpClient(url: string, token: string): DemoClient {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = async (res: Response, what: string): Promise<unknown> => {
    const text = await res.text();
    if (!res.ok) throw new Error(`${what} failed (HTTP ${res.status}): ${text.slice(0, 400)}`);
    return text ? (JSON.parse(text) as unknown) : null;
  };
  return {
    post: async (path, body) => call(await fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), `POST ${path}`),
    get: async (path) => call(await fetch(`${url}${path}`), `GET ${path}`),
  };
}

/** Online means the Meta API host answers at all; any HTTP response counts, a failure does not. */
export async function checkOnline(): Promise<boolean> {
  try {
    await fetch('https://api.meta.ai', { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

type Ev = { type: string; run?: string; payload: Record<string, unknown> };

async function events(client: DemoClient, task: string): Promise<Ev[]> {
  return ((await client.get(`/api/tasks/${task}/events`)) as { events: Ev[] }).events;
}

export type ReviewBeatOptions = {
  allowOnline?: boolean;
  isOnline?: () => Promise<boolean>;
  pause?: (message: string) => Promise<void>;
  out?: (line: string) => void;
};

/**
 * The review beat: offline with Glimmer, unless the person allowed the hosted chain. While
 * online it asks for the network to go off and refuses to run if it stays on.
 */
export async function reviewBeat(client: DemoClient, task: string, o: ReviewBeatOptions = {}): Promise<unknown> {
  const out = o.out ?? (() => undefined);
  if (o.allowOnline) return client.post(`/api/tasks/${task}/review`, {});
  const isOnline = o.isOnline ?? checkOnline;
  if (await isOnline()) {
    out('The network is on. Turn it off for the offline review, then press Enter.');
    await (o.pause ?? promptEnter)('Turn the network off, then press Enter. ');
    if (await isOnline()) throw new Error('The review beat refuses to run while online. Turn the network off, or pass --allow-online.');
  }
  return client.post(`/api/tasks/${task}/review`, { host: 'ollama' });
}

/** Waits for a line on stdin. The beats use it between beats unless --auto. One shared reader, so every pause works. */
export async function promptEnter(message: string): Promise<void> {
  const { createInterface } = await import('node:readline');
  promptEnter.rl ??= createInterface({ input: process.stdin });
  const rl = promptEnter.rl as ReturnType<typeof createInterface>;
  process.stdout.write(message);
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    rl.once('line', done);
    rl.once('close', done);
  });
}
promptEnter.rl = null as ReturnType<typeof import('node:readline').createInterface> | null;

export type LiveBeatsOptions = {
  client: DemoClient;
  out?: (line: string) => void;
  pause?: (message: string) => Promise<void>;
  auto?: boolean;
  allowOnline?: boolean;
  isOnline?: () => Promise<boolean>;
  killAfterSeconds?: number;
  timeoutMs?: number;
  pollMs?: number;
  implementer?: string;
  continuer?: string;
  /** Measures a proposed skill (with it and without, on fresh copies) before it is approved; returns the card line (R-049). */
  evalSkill?: (skill: string) => Promise<string | null>;
};

export type LiveSummary = {
  tasks: Array<{ id: string; status: string; usd: number | null }>;
  packet: { name: string; run: string; endedBy: string; hash: string; tokens: number } | null;
  skill: string | null;
  learnSkipped: string | null;
};

/** Beats 2 to 8 against a seeded workspace with a daemon up. Beat 1 (seed) runs before the daemon starts. */
export async function runLiveBeats(o: LiveBeatsOptions): Promise<LiveSummary> {
  const out = o.out ?? ((s: string) => process.stdout.write(`${s}\n`));
  const pause = o.auto ? async () => undefined : (o.pause ?? promptEnter);
  const timeoutMs = o.timeoutMs ?? 15 * 60_000;
  const pollMs = o.pollMs ?? 500;
  const implementer = o.implementer ?? 'muse-code';
  const continuer = o.continuer ?? 'stint-agent';
  const waitFor = async (task: string, pred: (es: Ev[]) => boolean, what: string): Promise<Ev[]> => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const es = await events(o.client, task);
      if (pred(es)) return es;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what} on ${task}`);
      await Bun.sleep(pollMs);
    }
  };
  const has = (type: string, run?: string) => (es: Ev[]) => es.some((e) => e.type === type && (run === undefined || e.run === run));

  // Beat 2: Wonder plans.
  await pause('Beat: Wonder plans T-0042. Press Enter. ');
  out('Planning T-0042.');
  await o.client.post('/api/tasks/T-0042/plan', {});

  // Beat 3: Muse Code builds, then it is killed once a src/ file has changed.
  await pause('Beat: Muse Code builds, then the kill. Press Enter. ');
  const assigned = (await o.client.post('/api/tasks/T-0042/assign', { adapter: implementer, role: 'implementer' })) as { run: string };
  out(`Assigned ${implementer} to T-0042 as ${assigned.run}.`);
  const seen = await waitFor(
    'T-0042',
    (es) =>
      es.some((e) => e.type === 'run.finished' && e.run === assigned.run) ||
      es.some((e) => e.type === 'file.changed' && e.run === assigned.run && String(e.payload.path ?? '').startsWith('src/')),
    'a src/ change or the end of the run',
  );
  if (!seen.some((e) => e.type === 'run.finished' && e.run === assigned.run)) {
    await Bun.sleep((o.killAfterSeconds ?? 6) * 1000);
    const now = await events(o.client, 'T-0042');
    if (!now.some((e) => e.type === 'run.finished' && e.run === assigned.run)) {
      out(`Killing ${assigned.run}.`);
      await o.client.post(`/api/tasks/T-0042/runs/${assigned.run}/stop`, {});
    }
  }
  await waitFor('T-0042', has('verification.ran', assigned.run), `verification of ${assigned.run}`);
  await waitFor('T-0042', has('handoff.created', assigned.run), `the packet from ${assigned.run}`);

  // Beat 4: a different agent finishes from the packet.
  await pause('Beat: a different agent finishes. Press Enter. ');
  const handed = (await o.client.post('/api/tasks/T-0042/hand', { adapter: continuer })) as { run: string; packet: string };
  out(`Handed T-0042 to ${continuer} as ${handed.run} from packet ${handed.packet}.`);
  await waitFor('T-0042', has('verification.ran', handed.run), `verification of ${handed.run}`);
  await waitFor('T-0042', has('handoff.created', handed.run), `the packet from ${handed.run}`);

  // Beat 5: review offline.
  await pause('Beat: review offline. Press Enter. ');
  out('Reviewing T-0042.');
  await reviewBeat(o.client, 'T-0042', { allowOnline: o.allowOnline, isOnline: o.isOnline, pause, out });

  // Beat 6: approve and merge, then learn.
  await pause('Beat: approve and merge, then it learns. Press Enter. ');
  await o.client.post('/api/tasks/T-0042/approve', {});
  out('Approved T-0042.');
  const learned = await waitFor('T-0042', (es) => es.some((e) => e.type === 'skill.proposed' || e.type === 'learn.skipped'), 'the learn step');
  const proposed = learned.filter((e) => e.type === 'skill.proposed').at(-1);
  const skipped = learned.filter((e) => e.type === 'learn.skipped').at(-1);
  let skill: string | null = null;
  let learnSkipped: string | null = null;
  if (proposed) {
    skill = String(proposed.payload.id ?? '');
    out(`The learn step proposed ${skill}.`);
    if (o.evalSkill) {
      out('Measuring it first: the same task with the skill and without, on fresh copies.');
      const card = await o.evalSkill(skill).catch((err: unknown) => {
        out(`The eval did not finish (${err instanceof Error ? err.message : String(err)}); approving on the evidence alone.`);
        return null;
      });
      if (card) out(card);
    }
    out(`Approving ${skill}.`);
    await o.client.post(`/api/skills/${skill}/approve`, {});
  } else {
    learnSkipped = String(skipped?.payload.reason ?? 'no recurrence');
    out(`The learn step proposed nothing: ${learnSkipped}.`);
    skill = null;
  }

  // Beat 7: T-0043 with the skill mounted, stopped at the gate.
  await pause('Beat: T-0043 runs with the skill. Press Enter. ');
  const t43 = (await o.client.post('/api/tasks/T-0043/assign', { adapter: implementer, role: 'implementer' })) as { run: string };
  out(`Assigned ${implementer} to T-0043 as ${t43.run}.`);
  await waitFor('T-0043', has('verification.ran', t43.run), `verification of T-0043 ${t43.run}`);
  await waitFor('T-0043', has('handoff.created', t43.run), `the packet from T-0043 ${t43.run}`);
  await o.client.post('/api/tasks/T-0043/review', o.allowOnline ? {} : { host: 'ollama' });
  out('T-0043 waits at approval.');

  // Beat 8: totals.
  const board = (await o.client.get('/api/tasks')) as { tasks: Array<{ task: { id: string; status: string }; cost: { usd: number | null } }> };
  const names = ((await o.client.get('/api/tasks/T-0042/handoffs')) as { names: string[] }).names;
  let packet: LiveSummary['packet'] = null;
  for (const name of names) {
    const got = (await o.client.get(`/api/tasks/T-0042/handoffs/${name}`)) as { packet: Parameters<typeof renderHandoff>[0] & { from: { run: string; endedBy: string }; hash: string } };
    if (got.packet.from.run === assigned.run) {
      packet = { name, run: got.packet.from.run, endedBy: got.packet.from.endedBy, hash: got.packet.hash, tokens: countTokens(renderHandoff(got.packet)) };
      break;
    }
  }
  const summary: LiveSummary = {
    tasks: board.tasks.map((t) => ({ id: t.task.id, status: t.task.status, usd: t.cost.usd })),
    packet,
    skill,
    learnSkipped,
  };
  for (const t of summary.tasks) out(`${t.id} ${t.status} $${(t.usd ?? 0).toFixed(2)}`);
  if (packet) out(`T-0042 packet ${packet.name} from ${packet.run}: ${packet.tokens} tokens, ${packet.hash}`);
  return summary;
}

/**
 * The skill eval for the demo: the proposed skill on the task it came from, with it and without, on fresh fixture
 * copies, recorded through the daemon. Two short runs; the card says what they found.
 */
async function measureSkill(root: string, skill: string, task: string): Promise<string | null> {
  const ws = await Workspace.open(root);
  const raw = await readJsonIfExists<unknown>(join(ws.cacheDir, 'proposals', `${skill}.json`));
  const parsed = raw ? SkillProposalSchema.safeParse(raw) : null;
  if (!parsed?.success) return null;
  const proposal = parsed.data;
  const { defs } = resolveSkillEvalTasks({ evidence: proposal.evidence, tags: proposal.tags, tasks: await ws.listTasks(), requested: [task] });
  const rows = await runSkillEvalLive({ root, skillId: skill, proposal, tasks: defs, implementer: 'muse-code', outRunsDir: join(root, '.stint', 'evals', skill, 'runs') });
  const file = buildSkillEval({ id: skill, rows, replay: false, tasks: defs.map((d) => d.id), heldOut: null });
  await recordEval(root, ws, file, proposal.evidence);
  return file.card;
}

export type LiveDemoOptions = {
  auto?: boolean;
  allowOnline?: boolean;
  killAfterSeconds?: number;
  /** Skip measuring the proposed skill; the skill card then shows no eval line. */
  noEval?: boolean;
  out?: (line: string) => void;
  preflight?: PreflightDeps;
};

/**
 * The full live run on a fresh fixture copy: preflight, seed (before any daemon, as seed
 * requires), then the daemon and the beats. The fixture copy is kept so it can be recorded.
 */
export async function runLiveDemo(o: LiveDemoOptions = {}): Promise<{ root: string; url: string; summary: LiveSummary }> {
  const out = o.out ?? ((s: string) => process.stdout.write(`${s}\n`));
  await assertPreflight({ ...o.preflight, allowOnline: o.allowOnline ?? o.preflight?.allowOnline });
  const root = freshFixture();
  await seedDemo(root);
  out('Seeded T-0040 (done), T-0042 and T-0043 (planned).');
  const d = await startDaemon({ root, quiet: true, digest: true });
  out(`Watch it at ${d.url}`);
  try {
    const summary = await runLiveBeats({
      client: httpClient(d.url, d.token),
      out,
      auto: o.auto,
      allowOnline: o.allowOnline,
      killAfterSeconds: o.killAfterSeconds,
      ...(o.noEval ? {} : { evalSkill: (skill: string) => measureSkill(root, skill, 'T-0042') }),
    });
    out(`Live run finished at ${d.url}`);
    out(`Repo: ${root}`);
    out(`Record it with: stint demo record --repo ${root} --out <file>`);
    return { root, url: d.url, summary };
  } finally {
    await d.stop();
  }
}
