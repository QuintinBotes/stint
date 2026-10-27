// The flow tests' server: a real daemon on a fresh copy of the fixture, seeded like the demo, with scripted fake
// agents and a fake model server standing in for the planner, reviewer, learn step, quiz and digest. Nothing here
// calls a hosted model or Ollama.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Adapter, type Config, DEFAULT_CONFIG, type RunContext, type RunResult } from '@stint-dev/core';
import { seedDemo } from '../../../../packages/cli/src/demo/seed';
import { acpAgent } from '../../../../packages/adapters/acp/src/index';
import { replayAdapter, startDaemon } from '@stint-dev/daemon';

const PLAN = {
  version: 'stint.plan/1',
  steps: [{ id: 1, text: 'Write the change', files: ['src/lib/change.ts'] }],
  filesToTouch: ['src/lib/change.ts'],
  risks: [],
  similarTasks: [],
};
const review = (prompt: string) => {
  const decision = /\[contradict\]/.test(prompt) ? /- (D[0-9]+): /.exec(prompt)?.[1] : undefined;
  if (decision) {
    return { version: 'stint.review/1', verdict: 'request_changes', summary: 'One finding reverses a decision.', findings: [{ id: 'F1', severity: 'major', text: 'Read the limit from the environment instead of config', contradictsDecision: decision }], blockers: [] };
  }
  // the recurring mistake learn looks for: a hard-coded limit, as T-0040's review found
  if (/\[learn\]/.test(prompt)) {
    return { version: 'stint.review/1', verdict: 'request_changes', summary: 'A hard-coded limit again.', findings: [{ id: 'F1', severity: 'major', file: 'src/lib/limiter.ts', text: 'The limit is hard-coded; read it through loadConfig() with a default', linksTo: 'R1' }], blockers: [] };
  }
  return { version: 'stint.review/1', verdict: 'approve', summary: 'No actionable findings.', findings: [], blockers: [] };
};
const proposal = (prompt: string) => ({
  version: 'stint.skillProposal/1',
  // the learn prompt carries the task title, so a [queue] task gets its own skill whichever flow runs first
  id: /\[queue\]/.test(prompt) ? 'limits-live-in-one-place' : 'limits-come-from-config',
  name: 'Limits come from config',
  description: 'Use when adding a limit, threshold, window or cap: read it through loadConfig() with a default.',
  roles: ['implementer', 'reviewer'],
  tags: ['limits'],
  rule: 'Every limit, threshold, window and cap is read through loadConfig() with a default, never written as a constant.',
  examples: [],
  // the evidence the learn step showed the model, as it would quote it back
  evidence: [...new Set([...prompt.matchAll(/T-[0-9]{4,}\/r[0-9]+#F[0-9]+/g)].map((m) => m[0]))].slice(0, 4),
  confidence: 0.8,
});

const models = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
    if (url.pathname !== '/api/chat') return new Response('not found', { status: 404 });
    const body = (await req.json()) as { messages: Array<{ content: string }>; format?: unknown };
    const prompt = body.messages.map((m) => m.content).join('\n');
    const schema = JSON.stringify(body.format ?? {});
    let answer: unknown;
    if (schema.includes('"verdict"')) answer = review(prompt);
    else if (schema.includes('"confidence"')) answer = proposal(prompt);
    else if (schema.includes('"statements"')) answer = { statements: [1, 2, 3].map((n) => ({ id: `S${n}`, text: `Fact ${n} about the run`, truth: n !== 3, blocking: n === 1 })) };
    else if (schema.includes('"answers"')) answer = { answers: [1, 2, 3].map((n) => ({ id: `S${n}`, answer: n === 1 ? 'true' : 'unknown', quote: '' })) };
    else if (schema.includes('"duplicates"')) {
      const title = /Title: (.+)/.exec(prompt)?.[1] ?? 'An issue';
      answer = { size: 'S', title, goal: `Done when ${title.toLowerCase()}.`, acceptance: [`${title} works`], duplicates: [], risk: 'low', reason: 'Small and new.' };
    } else if (schema.includes('"steps"')) answer = PLAN;
    else answer = { summary: 'The run wrote one file for its task.' };
    return Response.json({ message: { content: JSON.stringify(answer) }, prompt_eval_count: 120, eval_count: 30 });
  },
});

/** An implementer that writes one file named after its task, so merges never conflict and the tests can check it. */
function writer(id: string): Adapter {
  return {
    id,
    vendor: 'meta',
    roles: ['implementer'],
    capabilities: { editsFiles: true, runsCommands: false, resumable: false, structuredOutput: false, offline: true },
    available: async () => ({ ok: true, version: 'fake 1' }),
    gate: () => 'none',
    async run(ctx: RunContext): Promise<RunResult> {
      await ctx.emit({ type: 'agent.tool_call', payload: { tool: 'write_file', args: { path: `src/lib/${ctx.task.id}.ts` }, callId: 'c1' } });
      // the title goes in the file, so a marker in it ([contradict], [learn]) is in the diff the reviewer reads
      await Bun.write(`${ctx.worktree}/src/lib/${ctx.task.id}.ts`, `// ${ctx.task.title}\nexport const DONE = '${ctx.task.id} by ${id}';\n`);
      await ctx.emit({ type: 'agent.tool_result', payload: { tool: 'write_file', callId: 'c1', ok: true, summary: 'wrote 1 line' } });
      // say back what the prompt asked, so a flow can check what the run was told
      const ask = ctx.prompt.split('\n## Ask\n')[1]?.trim().split('\n')[0] ?? '';
      await ctx.emit({ type: 'agent.message', payload: { text: `Wrote src/lib/${ctx.task.id}.ts. Asked: ${ask}` } });
      return { endedBy: 'completed', cost: { inputTokens: 900, cachedTokens: 300, outputTokens: 60, usd: 0.0008 } };
    },
  };
}

/** An implementer that works until it is stopped, as a run someone kills. */
const sleeper: Adapter = {
  ...writer('sleeper'),
  id: 'sleeper',
  async run(ctx: RunContext): Promise<RunResult> {
    await ctx.emit({ type: 'agent.tool_call', payload: { tool: 'write_file', args: { path: `src/lib/${ctx.task.id}.ts` }, callId: 'c1' } });
    await new Promise<void>((resolve) => {
      if (ctx.signal.aborted) resolve();
      else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return { endedBy: 'killed', cost: { inputTokens: 400, cachedTokens: 0, outputTokens: 20, usd: 0.0003 }, inFlight: `write_file src/lib/${ctx.task.id}.ts` };
  },
};

const root = mkdtempSync(join(tmpdir(), 'stint-flows-'));
// a fake gh with two open issues, for the intake flow; the daemon runs in this process and finds it on PATH
const bin = join(root, '..', `stint-flows-bin-${process.pid}`);
mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, 'gh'), `#!/bin/sh\nif [ "$1" = "issue" ]; then cat <<'JSON'\n[{"number":7,"title":"Show the tenant name in the audit log","body":"Ops asked.","url":"https://example.invalid/acme/api/issues/7","labels":[]},{"number":8,"title":"Remove the legacy v0 webhook route","body":"Nobody calls it.","url":"https://example.invalid/acme/api/issues/8","labels":[]}]\nJSON\nexit 0; fi\nexit 1\n`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;
const clone = Bun.spawnSync(['git', 'clone', '-q', join(import.meta.dir, '..', '..', '..', '..', 'demo', 'repo.bundle'), root]);
if (clone.exitCode !== 0) throw new Error('cannot clone the fixture');
for (const [k, v] of [['user.name', 'Stint Flows'], ['user.email', 'flows@example.com'], ['commit.gpgsign', 'false']]) Bun.spawnSync(['git', '-C', root, 'config', k as string, v as string]);

const config: Config = structuredClone(DEFAULT_CONFIG);
config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: `http://127.0.0.1:${models.port}/v1`, models: { fake: 'fake' } };
for (const route of ['planner', 'reviewer', 'learn', 'summary', 'quiz', 'recall'] as const) config.routes[route] = ['ollama/fake'];
config.prices['ollama/fake'] = { input: 0.1, cached: 0.05, output: 0.4 };
config.prices['muse-code/muse-spark-1.3'] = { input: 0.6, cached: 0.15, output: 2.4 };
// green once the task's own file exists, with a summary line the verifier can count
config.testCommand = `sh -c 'test -f "src/lib/$STINT_TASK.ts" && printf " 1 pass\\n 0 fail\\n" || { printf "(fail) the task file > exists\\n 0 pass\\n 1 fail\\n"; exit 1; }'`;
config.autopilot = { implementers: ['muse-code', 'stint-agent'], maxHops: 2, parallel: 1 };
mkdirSync(join(root, '.stint'), { recursive: true });
writeFileSync(join(root, '.stint', 'config.json'), JSON.stringify(config, null, 2));
await seedDemo(root);

const d = await startDaemon({ root, port: Number(process.env.STINT_E2E_FLOWS_PORT ?? 4320), quiet: true, adapters: [replayAdapter, writer('muse-code'), writer('stint-agent'), sleeper, acpAgent('fake-acp', { command: ['bun', join(import.meta.dir, '..', '..', '..', '..', 'packages', 'adapters', 'acp', 'test', 'fixtures', 'fake-agent.ts')], prompt: 'stdin', roles: ['implementer'], vendor: 'other', enabled: true, harness: 'acp' })] });
process.stdout.write(`ready ${d.url} ${root}\n`);
const stop = () => {
  void d.stop().then(() => {
    models.stop(true);
    rmSync(root, { recursive: true, force: true });
    process.exit(0);
  });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
