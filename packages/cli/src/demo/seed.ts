import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Handoff, HandoffSchema, type Review, countTokens, renderHandoff } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { git, gitOk, identityArgs } from '@stint-dev/daemon';

export const DEMO_TASKS = [
  {
    id: 'T-0040',
    title: 'Add tenant header to audit log',
    goal: 'Every audit CSV row carries the tenant, and GET /audit filters by the X-Tenant header.',
    acceptance: ['The CSV has a tenant column', 'GET /audit filters by X-Tenant'],
    testCommand: 'bun run test',
    tags: ['audit'],
  },
  {
    id: 'T-0042',
    title: 'Rate-limit incoming webhooks per tenant',
    goal: 'POST /webhooks answers 429 with a Retry-After header when a tenant sends too many webhooks in a window, without affecting other tenants.',
    acceptance: [
      'A tenant over the limit gets 429 with a Retry-After header',
      'Other tenants are not affected',
      'The suite stays green',
    ],
    testCommand: 'bun run test',
    tags: ['webhooks', 'limits'],
  },
  {
    id: 'T-0043',
    title: 'Rate-limit the admin API',
    goal: 'The admin routes answer 429 with Retry-After over a limit, so a runaway script cannot flood tenant creation.',
    acceptance: ['The admin API answers 429 with Retry-After over the limit', 'The suite stays green'],
    testCommand: 'bun run test',
    tags: ['admin', 'limits'],
  },
] as const;

/**
 * T-0040's review. F2 is worded close to the finding T-0042 is expected to get (hard-coded limit
 * and window, read through loadConfig(), same risk R2), so the learn step's recurrence check,
 * which matches on shared theme words or a shared linksTo, can pair them.
 */
export const T0040_REVIEW: Review = {
  version: 'stint.review/1',
  verdict: 'approve',
  summary: 'The tenant column is right; two minor findings.',
  findings: [
    { id: 'F1', severity: 'minor', file: 'src/lib/backoff.ts', line: 4, text: 'The replay backoff has no jitter, so retries from many tenants line up.' },
    {
      id: 'F2',
      severity: 'minor',
      file: 'src/lib/audit.ts',
      line: 8,
      text: 'The export limit of 5000 rows and its window are hard-coded; read them through loadConfig() like the other limits.',
      linksTo: 'R2',
    },
  ],
  blockers: [],
  model: 'ollama/muse-glimmer:30b-mlx',
  offline: true,
  cost: { inputTokens: 2810, cachedTokens: 0, outputTokens: 330, usd: 0 },
  run: 'r3',
};

export const T0042_CONTEXT = {
  files: [
    { path: 'src/routes/webhooks.ts', note: 'POST /webhooks: the tenant check runs before the body is read' },
    { path: 'src/app.ts', note: 'createDeps and createApp: where a limiter dependency would be wired in' },
    { path: 'src/config.ts', note: 'loadConfig(): every tunable number belongs here, with a default' },
  ],
  similarTasks: ['T-0040'],
};

/** Seed writes through Workspace like the replayer, so it must never race a live daemon on the same files. */
export function assertNoDaemon(root: string): void {
  const path = join(root, '.stint', 'cache', 'daemon.json');
  if (!existsSync(path)) return;
  let pid: number | undefined;
  try {
    pid = (JSON.parse(readFileSync(path, 'utf8')) as { pid?: number }).pid;
  } catch {
    return;
  }
  if (!pid) return;
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (err) {
    alive = (err as NodeJS.ErrnoException).code === 'EPERM';
  }
  if (alive) throw new Error(`a Stint daemon is running for ${root} (pid ${pid}); stop it before seeding`);
}

function seedPacket(): Handoff | null {
  const path = join(import.meta.dir, '..', '..', '..', '..', 'demo', 'seed', 'T-0040', 'handoff.json');
  if (!existsSync(path)) return null;
  const parsed = HandoffSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  return parsed.success ? parsed.data : null;
}

async function findT0040Merge(root: string): Promise<string | null> {
  const r = await git(root, ['log', '--all', '--format=%H', '--grep=Stint-Task: T-0040', '-n', '1']);
  const sha = r.stdout.trim().split('\n')[0]?.trim();
  if (r.code === 0 && sha) {
    // the trailer must be on the checked-out branch, not only on some other ref
    const onMain = await git(root, ['merge-base', '--is-ancestor', sha, 'HEAD']);
    if (onMain.code === 0) return sha;
  }
  return null;
}

/**
 * The merge commit T-0040 landed as, built the way approve builds one: title and id, the packet
 * summary, then the Stint trailers. The fixture bundle already carries this commit on main, so
 * the common path only finds it; a repository without it gets a merge of stint/T-0040 (or a
 * branch forked at HEAD) with the same message.
 */
async function ensureT0040Merge(root: string, packet: Handoff | null): Promise<string> {
  const existing = await findT0040Merge(root);
  if (existing) return existing;
  const task = DEMO_TASKS[0];
  const trailers = {
    'Stint-Task': 'T-0040',
    'Stint-Runs': 'r1,r2,r3',
    'Stint-Handoff': packet?.hash ?? 'none',
    'Stint-Verified': 'bun run test 27/27',
  };
  const message = `${task.title} (T-0040)\n\n${packet?.summary ?? task.goal}\n\n${Object.entries(trailers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n`;
  const baseSha = (await gitOk(root, ['rev-parse', 'HEAD'])).trim();
  let branchSha: string;
  if ((await git(root, ['rev-parse', '--verify', '-q', 'refs/heads/stint/T-0040'])).code === 0) {
    branchSha = (await gitOk(root, ['rev-parse', 'stint/T-0040'])).trim();
  } else if ((await git(root, ['rev-parse', '--verify', '-q', 'refs/remotes/origin/stint/T-0040'])).code === 0) {
    branchSha = (await gitOk(root, ['rev-parse', 'origin/stint/T-0040'])).trim();
    await gitOk(root, ['branch', 'stint/T-0040', branchSha]);
  } else {
    await gitOk(root, ['branch', 'stint/T-0040', baseSha]);
    branchSha = baseSha;
  }
  const tree = (await gitOk(root, ['merge-tree', '--write-tree', '--no-messages', baseSha, branchSha])).trim().split('\n')[0] as string;
  const msgFile = join(root, '.stint', 'cache', 'merge-T-0040.txt');
  await Bun.write(msgFile, message);
  try {
    const commit = (await gitOk(root, [...(await identityArgs(root)), 'commit-tree', tree, '-p', baseSha, '-p', branchSha, '-F', msgFile])).trim();
    await gitOk(root, ['merge', '--ff-only', '-q', commit]);
    return commit;
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(msgFile, { force: true });
  }
}

const RUNS_T0040 = [
  { run: 'r1', adapter: 'openai-compatible', vendor: 'meta' as const, role: 'planner' as const, model: 'muse-wonder-1.0', host: 'meta-api', cost: { inputTokens: 4200, cachedTokens: 0, outputTokens: 640, usd: 0.0296 } },
  { run: 'r2', adapter: 'muse-code', vendor: 'meta' as const, role: 'implementer' as const, model: 'muse-spark-1.3', host: 'local-cli', cost: { inputTokens: 48210, cachedTokens: 31400, outputTokens: 2870, usd: 0.0401 } },
  { run: 'r3', adapter: 'openai-compatible', vendor: 'meta' as const, role: 'reviewer' as const, model: 'muse-glimmer:30b-mlx', host: 'ollama', cost: { inputTokens: 2810, cachedTokens: 0, outputTokens: 330, usd: 0 } },
];

async function seedT0040(ws: Workspace, packet: Handoff | null): Promise<void> {
  const def = DEMO_TASKS[0];
  await ws.createTask({ id: def.id, title: def.title, goal: def.goal, acceptance: [...def.acceptance], testCommand: def.testCommand, tags: [...def.tags] });
  const events = ws.events(def.id);
  // createTask already appended task.created; runs follow as events, with no git effects: the
  // fixture history already holds T-0040's commits, and a replay starts from that same history.
  for (const r of RUNS_T0040) {
    await ws.runs(def.id).create({ run: r.run, adapter: r.adapter, vendor: r.vendor, role: r.role, model: r.model, host: r.host, startedAt: new Date().toISOString() });
    await events.append({ task: def.id, run: r.run, adapter: r.adapter, vendor: r.vendor, type: 'run.started', payload: { role: r.role, model: r.model, host: r.host, seeded: true } });
    await events.append({
      task: def.id,
      run: r.run,
      adapter: r.adapter,
      vendor: r.vendor,
      type: 'run.finished',
      payload: { endedBy: 'completed', cost: r.cost, host: r.host, model: r.model, seeded: true },
    });
    await ws.runs(def.id).updateMeta(r.run, { endedAt: new Date().toISOString(), endedBy: 'completed', cost: r.cost });
  }
  const d1 = await ws.decisions(def.id).append({ text: 'The audit export filters by the X-Tenant header, not by a query parameter', by: 'muse-code r2' });
  await events.append({ task: def.id, run: 'r2', adapter: 'muse-code', vendor: 'meta', type: 'decision.recorded', payload: { id: d1.id, text: d1.text, by: d1.by }, links: [{ kind: 'decision', ref: d1.id }] });
  await ws.verification(def.id).write({ run: 'r2', command: 'bun run test', exitCode: 0, passed: 27, failed: 0, durationMs: 1480, runBy: 'daemon', status: 'green', outputRef: 'verification/r2.out.txt', at: new Date().toISOString() });
  await events.append({ task: def.id, run: 'r2', vendor: 'daemon', type: 'verification.ran', payload: { command: 'bun run test', exitCode: 0, passed: 27, failed: 0, durationMs: 1480, status: 'green', runBy: 'daemon', seeded: true } });
  if (packet) {
    const name = await ws.handoffs(def.id).write(packet);
    const text = renderHandoff(packet);
    await events.append({
      task: def.id,
      run: 'r2',
      vendor: 'daemon',
      type: 'handoff.created',
      payload: { name, hash: packet.hash, from: packet.from, to: packet.to ?? null, tokens: countTokens(text), bytes: new TextEncoder().encode(text).length, reason: 'completed', packet, seeded: true },
      links: [{ kind: 'handoff', ref: name }],
    });
  }
  await ws.writeReview(def.id, T0040_REVIEW);
  await events.append({
    task: def.id,
    run: 'r3',
    adapter: 'openai-compatible',
    vendor: 'meta',
    type: 'review.recorded',
    payload: { verdict: T0040_REVIEW.verdict, findings: T0040_REVIEW.findings.length, contradictions: 0, offline: true, review: T0040_REVIEW, seeded: true },
    links: T0040_REVIEW.findings.map((f) => ({ kind: 'finding' as const, ref: f.id })),
  });
  await ws.writeTask(def.id, { status: 'done', assignee: null });
}

export type SeedResult = { created: string[]; existing: string[]; merge: string };

/** Sets up the three demo tasks on a fixture copy. Idempotent: a second run changes nothing. */
export async function seedDemo(root: string): Promise<SeedResult> {
  assertNoDaemon(root);
  const packet = seedPacket();
  const merge = await ensureT0040Merge(root, packet);
  const ws = await Workspace.open(root);
  const have = new Set((await ws.listTasks()).map((t) => t.id));
  const created: string[] = [];
  const existing: string[] = [];
  for (const def of DEMO_TASKS) (have.has(def.id) ? existing : created).push(def.id);
  if (!have.has('T-0040')) await seedT0040(ws, packet);
  for (const def of [DEMO_TASKS[1], DEMO_TASKS[2]]) {
    if (!have.has(def.id)) {
      await ws.createTask({ id: def.id, title: def.title, goal: def.goal, acceptance: [...def.acceptance], testCommand: def.testCommand, tags: [...def.tags] });
    }
  }
  if ((await ws.readDoc('T-0042', 'context.json')) === null) await ws.writeDoc('T-0042', 'context.json', T0042_CONTEXT);
  return { created, existing, merge };
}
