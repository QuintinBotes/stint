import { expect, test } from 'bun:test';
import type { Draft, SharpenState, Task } from '@stint-dev/core';
import { costs } from '@stint-dev/core/node';
import type { GoalView } from '../src/goals';
import { sharpenBrief } from '../src/sharpen';
import { setup } from './autopilot.fixtures';
import { post, withFixtureRepo } from './helpers';

const question = (text: string, changes: string, safe: boolean, labels = ['Only an admin', 'Anyone on the team']) => ({
  text,
  changes,
  evidence: 'The words do not say, and no file decides it.',
  options: labels.map((label) => ({ label, consequence: `If ${label.toLowerCase()}.` })),
  recommendation: { option: labels[0], why: 'It is the smaller change.' },
  safeDefault: safe ? { exists: true, option: labels[0] } : { exists: false },
  blocks: [1],
  material: false,
});

const SPEC = {
  kind: 'task',
  kindReason: 'One agent can build and verify it in one run.',
  title: 'Health check',
  summary: 'Operators can tell the service is up.',
  stories: [
    { title: 'Ask if it is up', priority: 'P1', why: 'It is the whole point.', scenarios: [{ given: 'the service is running', when: 'GET /health is called', then: 'it answers 200 with ok' }] },
    { title: 'See why it is down', priority: 'P2', why: 'A failure must say what is wrong.', scenarios: [{ given: 'the database is down', when: 'GET /health is called', then: 'it answers 503 naming the database' }] },
  ],
  requirements: [{ id: 'FR-001', text: 'System MUST answer GET /health.' }],
  success: [{ id: 'SC-001', text: 'GET /health answers within 100 ms.' }],
  edgeCases: [],
  assumptions: [],
  nonGoals: ['Metrics'],
  open: [{ id: 'O1', text: 'Who may see why the service is down?' }],
};

/** A planner that drafts the spec above with three questions, one the repository can answer, and asks one more on each refine. */
function fakeDrafter() {
  const prompts: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (new URL(req.url).pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      const prompt = ((await req.json()) as { messages: Array<{ content: string }> }).messages.map((m) => m.content).join('\n');
      prompts.push(prompt);
      const refine = prompt.includes('You refine a draft spec');
      const out = refine
        ? { ...SPEC, questions: [question('Should the 503 body name every failing part?', 'implementation', true, ['Yes', 'No'])], assumed: [] }
        : { ...SPEC, questions: [question('Who may see why the service is down?', 'authority', false), question('Should the check write a log line on each call?', 'implementation', true), question('Which file holds the routes?', 'implementation', true)], assumed: [{ text: 'The check needs no token.', why: 'Load balancers call it.' }] };
      return Response.json({ message: { content: JSON.stringify(out) }, prompt_eval_count: 100, eval_count: 20 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, prompts, stop: () => server.stop(true) };
}

const IMPORTED = `# Feature Specification: Health check

**Input**: User description: "Operators can tell the service is up"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask if it is up (Priority: P1)

**Why this priority**: It is the whole point.

**Acceptance Scenarios**:

1. **Given** the service is running, **When** GET /health is called, **Then** it answers 200

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST answer GET /health [NEEDS CLARIFICATION: with or without a token?]

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: GET /health answers within 100 ms.
`;

test('A draft is one planner call recorded as workspace spend for draft, keeps the valid questions, and refines at most two rounds; creating it makes a task with its acceptance, proofs and one decision per answer', async () => {
  const models = fakeDrafter();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [], models);
      expect((await post(app, '/api/drafts', { input: 'Add a health check' }, {})).status).toBe(401);

      const res = await post(app, '/api/drafts', { input: 'Add a health check' });
      expect(res.status).toBe(200);
      const draft = (await res.json()) as Draft;
      expect(models.prompts[0]).toContain('## What the person wants\nAdd a health check\n');
      expect(models.prompts[0]).toContain('- src/routes/webhooks.ts');
      // the question the repository can answer is dropped, and the material one comes first
      expect(draft.questions.map((q) => [q.id, q.round, q.material, q.text])).toEqual([
        ['Q1', 1, true, 'Who may see why the service is down?'],
        ['Q2', 1, false, 'Should the check write a log line on each call?'],
      ]);
      expect(draft).toMatchObject({ version: 'stint.draft/1', input: 'Add a health check', kind: 'task', assumed: [{ id: 'A1', text: 'The check needs no token.' }], open: [{ id: 'O1' }], answers: [] });
      // the call's cost and nothing else is written
      const written = await ws.workspaceEvents().read();
      expect(written.map((e) => [e.type, e.payload.for, e.payload.step, e.payload.host])).toEqual([['cost.recorded', 'draft', 'draft', 'ollama']]);
      expect(written[0]?.payload.cost).toMatchObject({ inputTokens: 100, outputTokens: 20, usd: 0 });
      expect((await costs(ws, { group: 'model' })).find((r) => r.key === 'ollama/fake')?.roles).toEqual(['draft']);
      expect(await ws.listTasks()).toEqual([]);

      // an answer that is not an option is refused before any call
      expect((await post(app, '/api/drafts/refine', { draft, answers: [{ question: 'Q1', choice: 'Nobody' }] })).status).toBe(400);
      expect(models.prompts).toHaveLength(1);

      const second = (await (await post(app, '/api/drafts/refine', { draft, answers: [{ question: 'Q1', choice: 'Only an admin' }] })).json()) as Draft;
      expect(models.prompts[1]).toContain('- Q1: Who may see why the service is down? Answer: Only an admin');
      expect(second.questions.map((q) => [q.id, q.round])).toEqual([
        ['Q1', 1],
        ['Q2', 1],
        ['Q3', 2],
      ]);
      // the second refine is past the last round: the model is told to ask nothing, what it asks anyway is dropped, and what is still open is assumed
      const third = (await (await post(app, '/api/drafts/refine', { draft: second, answers: [{ question: 'Q3', choice: 'Yes' }] })).json()) as Draft;
      expect(models.prompts[2]).toContain('This was the last round of questions: return no questions.');
      expect(third.questions.map((q) => q.id)).toEqual(['Q1', 'Q2', 'Q3']);
      expect(third.open).toEqual([]);
      expect(third.assumed.at(-1)).toEqual({ id: 'A2', text: 'Still open: Who may see why the service is down?', why: 'Still open after 2 rounds of questions; change it on the task if it matters.' });
      expect(third.answers).toEqual([
        { question: 'Q1', choice: 'Only an admin' },
        { question: 'Q3', choice: 'Yes' },
      ]);
      expect((await ws.workspaceEvents().read()).map((e) => e.payload.step)).toEqual(['draft', 'refine', 'refine']);

      // the person edits a scenario, then creates the task
      const edited = structuredClone(third);
      (edited.stories[0] as Draft['stories'][number]).scenarios[0] = { given: 'the service is running', when: 'GET /health is called', then: 'it answers 200 with {"ok":true}' };
      const created = await post(app, '/api/drafts/create', { draft: edited });
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ kind: 'task', id: 'T-0001' });
      const task = await ws.readTask('T-0001');
      expect(task).toMatchObject({
        title: 'Health check',
        goal: 'Operators can tell the service is up.\n\nRequirements:\n- FR-001: System MUST answer GET /health.\n\nNot in scope:\n- Metrics',
        acceptance: ['Given the service is running, when GET /health is called, then it answers 200 with {"ok":true}', 'Given the database is down, when GET /health is called, then it answers 503 naming the database'],
        proofs: [
          { criterion: 1, kind: 'scenario', ref: 'it answers 200 with {"ok":true}' },
          { criterion: 2, kind: 'scenario', ref: 'it answers 503 naming the database' },
        ],
      } satisfies Partial<Task>);
      expect((await ws.decisions('T-0001').validAt()).map((d) => [d.id, d.text, d.by, d.evidence])).toEqual([
        ['D1', 'Who may see why the service is down? Answer: Only an admin', 'you', ['spec builder']],
        ['D2', 'Should the 503 body name every failing part? Answer: Yes', 'you', ['spec builder']],
      ]);
      // the draft's questions are the task's first Sharpen round: Q2 waits, nothing material does, and every line has its proof
      const st = (await (await app.request('/api/tasks/T-0001/sharpen')).json()) as SharpenState;
      expect(st).toMatchObject({ round: 1, open: ['Q2'], openMaterial: [], ready: true, assumed: [{ id: 'A1' }, { id: 'A2', text: 'Still open: Who may see why the service is down?' }] });
      expect(st.questions.find((q) => q.id === 'Q1')?.answered).toMatchObject({ option: 'Only an admin', decision: 'D1', by: 'you' });
      // so the plan and the first build carry the answers
      expect(await sharpenBrief(ws, task)).toContain('- D1: Who may see why the service is down? Answer: Only an admin');
    });
  } finally {
    models.stop();
  }
}, 60_000);

test('A goal draft makes a goal with its criteria, one decision per answer and a split of one task per story, P1 first, whose tasks start with those decisions', async () => {
  const models = fakeDrafter();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [], models);
      const draft = (await (await post(app, '/api/drafts', { input: 'Add a health check', kind: 'goal' })).json()) as Draft;
      expect(draft).toMatchObject({ kind: 'goal', kindReason: 'You asked for a goal.' });
      expect(models.prompts[0]).toContain('The person asked for a goal.');
      const p2First = { ...draft, stories: [...draft.stories].reverse(), answers: [{ question: 'Q1', choice: 'Only an admin' }] };
      expect(await (await post(app, '/api/drafts/create', { draft: p2First })).json()).toEqual({ kind: 'goal', id: 'G-0001' });

      const view = (await (await app.request('/api/goals/G-0001')).json()) as GoalView;
      expect(view.goal).toMatchObject({ title: 'Health check', status: 'draft', criteria: [{ text: 'GET /health answers within 100 ms.' }], nonGoals: ['Metrics'] });
      expect(view.goal.decisions.map((d) => [d.id, d.text, d.by])).toEqual([['D1', 'Who may see why the service is down? Answer: Only an admin', 'you']]);
      expect(view.proposal?.map((t) => [t.title, t.acceptance, t.covers, t.dependsOn])).toEqual([
        ['Ask if it is up', ['Given the service is running, when GET /health is called, then it answers 200 with ok'], [1], []],
        ['See why it is down', ['Given the database is down, when GET /health is called, then it answers 503 naming the database'], [1], []],
      ]);
      expect(view.sharpen).toMatchObject({ round: 1, open: ['Q2'], openMaterial: [] });
      const events = await ws.workspaceEvents().read();
      expect(events.map((e) => e.type)).toEqual(['cost.recorded', 'goal.created', 'goal.planned', 'sharpen.asked', 'sharpen.answered']);

      const made = (await (await post(app, '/api/goals/G-0001/tasks', { tasks: view.proposal })).json()) as { tasks: Task[] };
      expect(made.tasks.map((t) => [t.id, t.goalId])).toEqual([
        ['T-0001', 'G-0001'],
        ['T-0002', 'G-0001'],
      ]);
      expect((await ws.decisions('T-0002').validAt()).map((d) => [d.text, d.evidence])).toEqual([['Who may see why the service is down? Answer: Only an admin', ['goal:G-0001/D1']]]);
      // a goal needs a success criterion, and nothing is made without one
      expect((await post(app, '/api/drafts/create', { draft: { ...draft, success: [] } })).status).toBe(400);
      expect((await ws.listGoals()).map((g) => g.id)).toEqual(['G-0001']);
    });
  } finally {
    models.stop();
  }
}, 60_000);

test('A replay refuses drafting and refining with a plain reason, and still opens a Spec Kit spec, exports it and creates from it, with no model call', async () => {
  const models = fakeDrafter();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [], models);
      expect((await post(app, '/api/demo/play', { speed: 0 })).status).toBe(202);
      while (((await (await app.request('/api/demo/status')).json()) as { playing: boolean }).playing) await Bun.sleep(20);

      const refused = await post(app, '/api/drafts', { input: 'Add a health check' });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: { code: 'forbidden', message: 'a replay calls no model, so it cannot draft a spec', hint: 'open a Spec Kit spec, or write the task yourself' } });

      const opened = await post(app, '/api/drafts/import', { spec: IMPORTED });
      expect(opened.status).toBe(200);
      const draft = (await opened.json()) as Draft;
      expect(draft).toMatchObject({ kind: 'task', title: 'Health check', input: 'Operators can tell the service is up', open: [{ id: 'O1', text: 'with or without a token?' }] });
      expect((await post(app, '/api/drafts/refine', { draft, answers: [] })).status).toBe(403);

      const exported = await post(app, '/api/drafts/export', { draft });
      expect(exported.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
      expect((await exported.text()).split('\n')[0]).toBe('# Feature Specification: Health check');

      const created = (await (await post(app, '/api/drafts/create', { draft })).json()) as { kind: string; id: string };
      expect(created.kind).toBe('task');
      expect((await ws.readTask(created.id)).acceptance).toEqual(['Given the service is running, when GET /health is called, then it answers 200']);

      const bad = await post(app, '/api/drafts/import', { spec: 'Some notes.' });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: { hint: string[] } }).error.hint).toEqual([
        'The spec has no title; Spec Kit starts it with # Feature Specification: Name.',
        'The spec has no user stories; Spec Kit writes each as ### User Story 1 - Title (Priority: P1).',
      ]);
      expect(models.prompts).toEqual([]);
    });
  } finally {
    models.stop();
  }
}, 120_000);
