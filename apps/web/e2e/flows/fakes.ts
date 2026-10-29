// The fake agents and model server the flow tests run against, shared with the README commands test: a model server
// standing in for the planner, reviewer, learn step, quiz, digest, sharpen, a goal's split and a spec builder draft, writer agents that each write one file, and the
// config that points a workspace at them. Nothing here calls a hosted model or Ollama.
import { join } from 'node:path';
import { type Adapter, type Config, DEFAULT_CONFIG, type RunContext, type RunResult } from '@stint-dev/core';
import { acpAgent } from '../../../../packages/adapters/acp/src/index';

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

/** A sharpen round: one material question (who may decide), one with a safe default, one the repository can answer, and a test per criterion. */
const questions = (prompt: string) => {
  const criteria = [...(prompt.split(/## The (?:task|goal)\n/)[1] ?? '').matchAll(/^(\d+)\. (.+)$/gm)].map((m) => m[2] as string);
  const ask = (text: string, changes: string, options: Array<[string, string]>, safe: boolean) => ({
    text,
    changes,
    evidence: 'The task does not say, and nothing in the repository decides it.',
    options: options.map(([label, consequence]) => ({ label, consequence })),
    recommendation: { option: options[0]?.[0] ?? '', why: 'It is the smaller change.' },
    safeDefault: safe ? { exists: true, option: options[0]?.[0], why: 'Cheap to change later.' } : { exists: false },
    blocks: [1],
    material: false,
  });
  return {
    version: 'stint.questions/1',
    questions: [
      ask('Should the change write a log line each time it runs?', 'implementation', [['One line per run', 'The log grows a little.'], ['No log line', 'Nothing shows that it ran.']], true),
      ask('Who may turn the new behaviour off once it ships?', 'authority', [['Only an admin', 'A person with admin rights changes it.'], ['Anyone on the team', 'Any person can change it.']], false),
      ask('Which file holds the change?', 'implementation', [['src/lib', 'One place.'], ['src/routes', 'Another place.']], true),
    ],
    assumed: [{ text: 'The change lives in one new file.', why: 'The task is small.' }],
    proofs: criteria.map((c, i) => ({ criterion: i + 1, kind: 'test', ref: c.slice(0, 200), why: 'A test can check it.' })),
  };
};

/** A goal split: one task for each of the goal's first two criteria, the second waiting on the first. */
const split = (prompt: string) => {
  const criteria = [...(prompt.split('## The goal\n')[1] ?? '').matchAll(/^(\d+)\. (.+?)(?: \(proven by .+\))?$/gm)].map((m) => m[2] as string).slice(0, 2);
  return { tasks: criteria.map((c, i) => ({ title: `Part ${i + 1}: ${c}`.slice(0, 120), goal: `${c}, as one task of the goal.`, acceptance: [c], covers: [i + 1], dependsOn: i ? [0] : [] })) };
};

/**
 * A spec builder draft by the words of the input: a goal when they say goal or the person asked for one, else a task.
 * It has two stories, one material question (who may decide), one with a safe default and one the repository can
 * answer. A refine keeps the draft it is shown, settles what was open and asks nothing more.
 */
const draft = (prompt: string) => {
  const shown = /## The draft\n(.+)/.exec(prompt)?.[1];
  if (shown) return { ...JSON.parse(shown), open: [], questions: [], assumed: [] };
  const ask = (text: string, changes: string, options: Array<[string, string]>, safe: boolean) => ({
    text,
    changes,
    evidence: 'The words do not say, and nothing in the repository decides it.',
    options: options.map(([label, consequence]) => ({ label, consequence })),
    recommendation: { option: options[0]?.[0] ?? '', why: 'It is the smaller change.' },
    safeDefault: safe ? { exists: true, option: options[0]?.[0], why: 'Cheap to change later.' } : { exists: false },
    blocks: [1],
    material: false,
  });
  const words = (/## What the person wants\n(.+)/.exec(prompt)?.[1] ?? 'Make the change').trim();
  const title = words.replace(/[.!?]+$/, '').slice(0, 120);
  const goal = /\bgoal\b/i.test(words) || prompt.includes('The person asked for a goal.');
  return {
    kind: goal ? 'goal' : 'task',
    kindReason: goal ? 'It has two stories that each ship on their own.' : 'One agent can build and verify it in one run.',
    title,
    summary: `${title}, so a person can rely on it.`,
    stories: [
      { title: 'The main path', priority: 'P1', why: 'It is what the person asked for.', scenarios: [{ given: 'the service is running', when: 'a person uses the change', then: 'it does what was asked' }] },
      { title: 'When it fails', priority: 'P2', why: 'A failure must say what went wrong.', scenarios: [{ given: 'the change cannot run', when: 'a person uses it', then: 'they see why it failed' }] },
    ],
    requirements: [{ id: 'FR-001', text: `The system MUST do what was asked: ${title}.`.slice(0, 300) }],
    success: [{ id: 'SC-001', text: 'Both stories pass their scenarios.' }],
    edgeCases: ['What happens when it runs twice at once?'],
    assumptions: [],
    nonGoals: ['A settings page'],
    open: [{ id: 'O1', text: 'Who may turn it off once it ships?' }],
    questions: [
      ask('Who may turn the new behaviour off once it ships?', 'authority', [['Only an admin', 'A person with admin rights changes it.'], ['Anyone on the team', 'Any person can change it.']], false),
      ask('Should the change write a log line each time it runs?', 'implementation', [['One line per run', 'The log grows a little.'], ['No log line', 'Nothing shows that it ran.']], true),
      ask('Which file holds the change?', 'implementation', [['src/lib', 'One place.'], ['src/routes', 'Another place.']], true),
    ],
    assumed: [{ text: 'The change lives in one new file.', why: 'The task is small.' }],
  };
};

/** A model server that answers each structured call by its schema, on a free port. */
export function startFakeModels(): { port: number; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      if (url.pathname !== '/api/chat') return new Response('not found', { status: 404 });
      const body = (await req.json()) as { messages: Array<{ content: string }>; format?: unknown };
      const prompt = body.messages.map((m) => m.content).join('\n');
      const schema = JSON.stringify(body.format ?? {});
      let answer: unknown;
      if (schema.includes('"kindReason"')) answer = draft(prompt);
      else if (schema.includes('"safeDefault"')) answer = questions(prompt);
      else if (schema.includes('"verdict"')) answer = review(prompt);
      else if (schema.includes('"confidence"')) answer = proposal(prompt);
      else if (schema.includes('"statements"')) answer = { statements: [1, 2, 3].map((n) => ({ id: `S${n}`, text: `Fact ${n} about the run`, truth: n !== 3, blocking: n === 1 })) };
      else if (schema.includes('"answers"')) answer = { answers: [1, 2, 3].map((n) => ({ id: `S${n}`, answer: n === 1 ? 'true' : 'unknown', quote: '' })) };
      else if (schema.includes('"duplicates"')) {
        const title = /Title: (.+)/.exec(prompt)?.[1] ?? 'An issue';
        answer = { size: 'S', title, goal: `Done when ${title.toLowerCase()}.`, acceptance: [`${title} works`], duplicates: [], risk: 'low', reason: 'Small and new.' };
      } else if (schema.includes('"covers"')) answer = split(prompt);
      else if (schema.includes('"steps"')) answer = PLAN;
      else answer = { summary: 'The run wrote one file for its task.' };
      return Response.json({ message: { content: JSON.stringify(answer) }, prompt_eval_count: 120, eval_count: 30 });
    },
  });
  return { port: server.port as number, stop: () => server.stop(true) };
}

/** An implementer that writes one file named after its task, so merges never conflict and the tests can check it. */
export function writer(id: string): Adapter {
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
export const sleeper: Adapter = {
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

/** The fake ACP agent, driven over the Agent Client Protocol like goose or opencode. */
export function fakeAcp(): Adapter {
  return acpAgent('fake-acp', { command: ['bun', join(import.meta.dir, '..', '..', '..', '..', 'packages', 'adapters', 'acp', 'test', 'fixtures', 'fake-agent.ts')], prompt: 'stdin', roles: ['implementer'], vendor: 'other', enabled: true, harness: 'acp' });
}

/** A workspace config that sends every model call to the fake server and verifies by the task's own file. */
export function flowConfig(modelsPort: number): Config {
  const config: Config = structuredClone(DEFAULT_CONFIG);
  config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: `http://127.0.0.1:${modelsPort}/v1`, models: { fake: 'fake' } };
  for (const route of ['planner', 'reviewer', 'learn', 'summary', 'quiz', 'recall'] as const) config.routes[route] = ['ollama/fake'];
  config.prices['ollama/fake'] = { input: 0.1, cached: 0.05, output: 0.4 };
  config.prices['muse-code/muse-spark-1.3'] = { input: 0.6, cached: 0.15, output: 2.4 };
  // green once the task's own file exists, with a summary line the verifier can count
  config.testCommand = `sh -c 'test -f "src/lib/$STINT_TASK.ts" && printf " 1 pass\\n 0 fail\\n" || { printf "(fail) the task file > exists\\n 0 pass\\n 1 fail\\n"; exit 1; }'`;
  config.autopilot = { implementers: ['muse-code', 'stint-agent'], maxHops: 2, parallel: 1 };
  return config;
}
