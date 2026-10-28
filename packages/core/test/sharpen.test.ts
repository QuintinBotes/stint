import { describe, expect, test } from 'bun:test';
import { type ModelQuestion, type Questions, type StintEvent, Workspace, costs, isMaterial, questionProblem, sharpenRound, sharpenState } from '../src/node';
import { tempDir } from './fixture';

const good: ModelQuestion = {
  text: 'What should a tenant over the limit get back?',
  changes: 'implementation',
  evidence: 'The goal names 429 but test/webhooks.test.ts expects 503.',
  options: [
    { label: '429 with Retry-After', consequence: 'Senders back off on their own.' },
    { label: '503 as today', consequence: 'Senders retry at once.' },
  ],
  recommendation: { option: '429 with Retry-After', why: 'It is what the goal says.' },
  safeDefault: { exists: true, option: '429 with Retry-After', why: 'A status code is cheap to change.' },
  blocks: [1],
  material: false,
};
const q = (patch: Partial<ModelQuestion>): ModelQuestion => ({ ...good, ...patch });

describe('The question validator', () => {
  test('a valid question passes', () => {
    expect(questionProblem(good, 3)).toBeNull();
    expect(questionProblem(q({ blocks: [] }), 3)).toBeNull();
    expect(questionProblem(q({ options: [...good.options, { label: 'Drop the webhook', consequence: 'Nothing is retried.' }, { label: 'Queue it', consequence: 'It runs later.' }] }), 3)).toBeNull();
  });

  test('each rule rejects its case, with a reason', () => {
    const cases: Array<[string, ModelQuestion, RegExp]> = [
      ['no question mark', q({ text: 'Tell me what a tenant over the limit gets back.' }), /question mark/],
      ['fewer than 5 words', q({ text: 'Is it per tenant?' }), /fewer than 5 words/],
      ['changes outside the four', q({ changes: 'design' }), /not implementation, proof, scope or authority/],
      ['empty evidence', q({ evidence: '  ' }), /what Stint found/],
      ['one option', q({ options: [good.options[0] as ModelQuestion['options'][number]] }), /1 option; a question needs 2 to 4/],
      ['five options', q({ options: ['A', 'B', 'C', 'D', 'E'].map((label) => ({ label, consequence: `If ${label}.` })), recommendation: { option: 'A', why: 'first' }, safeDefault: { exists: false } }), /5 options/],
      ['two options with one label', q({ options: [good.options[0], good.options[0]] as ModelQuestion['options'] }), /same label/],
      ['an option with no consequence', q({ options: [good.options[0], { label: '503 as today', consequence: '' }] as ModelQuestion['options'] }), /no consequence/],
      ['a recommendation not among the options', q({ recommendation: { option: '418', why: 'A joke.' } }), /recommendation is not one of its options/],
      ['a recommendation with no why', q({ recommendation: { option: '503 as today', why: ' ' } }), /does not say why/],
      ['a safe default not among the options', q({ safeDefault: { exists: true, option: 'Something else' } }), /safe default is not one of its options/],
      ['a criterion the task does not have', q({ blocks: [1, 4] }), /criterion 4, which the task does not have/],
      ['a question the repository can answer', q({ text: 'Which file holds the limiter?' }), /repository can answer it/],
      ['what version', q({ text: 'What version of Hono does it use?' }), /repository can answer it/],
      ['where is', q({ text: 'Where is the tenant id read from the request?' }), /repository can answer it/],
      ['does the repo', q({ text: 'Does the repo already have a limiter?' }), /repository can answer it/],
      ['what framework', q({ text: 'What framework do the tests use here?' }), /repository can answer it/],
      ['asking for permission', q({ text: 'Should I proceed?' }), /permission or an opinion/],
      ['do you want me to', q({ text: 'Do you want me to add the limiter now?' }), /permission or an opinion/],
      ['any thoughts', q({ text: 'Any thoughts on how the window should work?' }), /permission or an opinion/],
      ['is that ok', q({ text: 'I will use a sliding window, is that ok?' }), /permission or an opinion/],
    ];
    for (const [name, question, reason] of cases) expect(questionProblem(question, 3) ?? `${name} passed`).toMatch(reason);
  });

  test('the repository patterns ignore case and do not catch words that only start the same', () => {
    expect(questionProblem(q({ text: 'WHICH FILE holds the limiter today?' }), 3)).toMatch(/repository/);
    expect(questionProblem(q({ text: 'Where isolation between tenants matters, what wins?' }), 3)).toBeNull();
  });
});

describe('Material questions', () => {
  test('the code upgrades a question to material by a keyword in the text or an option, by changes scope or authority, and by no safe default', () => {
    expect(isMaterial(good)).toBe(false);
    expect(isMaterial(q({ text: 'Should the limit apply before authentication of the sender?' }))).toBe(true);
    expect(isMaterial(q({ options: [good.options[0], { label: 'Delete old counters', consequence: 'Their history is gone.' }] as ModelQuestion['options'] }))).toBe(true);
    expect(isMaterial(q({ options: [good.options[0], { label: 'Per plan', consequence: 'The limit follows the billing tier.' }] as ModelQuestion['options'] }))).toBe(true);
    for (const word of ['security', 'permissions', 'secrets', 'personal data', 'payments', 'prices', 'money', 'dropping the table', 'a migration', 'irreversible']) {
      expect(isMaterial(q({ text: `Does this change touch ${word} in any way?` }))).toBe(true);
    }
    expect(isMaterial(q({ changes: 'scope' }))).toBe(true);
    expect(isMaterial(q({ changes: 'authority' }))).toBe(true);
    expect(isMaterial(q({ safeDefault: { exists: false } }))).toBe(true);
  });

  test('the code never downgrades: a question the model calls material stays material', () => {
    expect(isMaterial(q({ material: true }))).toBe(true);
    const round = sharpenRound({ version: 'stint.questions/1', questions: [q({ material: true })], assumed: [], proofs: [] }, { criteria: 1, maxQuestions: 5, firstQuestion: 1, firstAssumed: 1 });
    expect(round.questions[0]?.material).toBe(true);
  });
});

describe('A round', () => {
  const out: Questions = {
    version: 'stint.questions/1',
    questions: [
      q({ text: 'What should a tenant over the limit get back first?' }),
      q({ text: 'Which file holds the limiter?' }),
      q({ text: 'Do retries of a failed webhook count towards the limit?', changes: 'scope' }),
      q({ text: 'Is the window sliding or fixed for every tenant?' }),
      q({ text: 'Should the counters survive a restart of the service?', safeDefault: { exists: false } }),
      q({ text: 'Does the limit apply to the health check route too?' }),
      q({ text: 'Is the limit counted per tenant or per sender key?' }),
    ],
    assumed: [{ text: 'The window is 60 seconds.', why: 'Easy to change in config.' }],
    proofs: [
      { criterion: 1, kind: 'test', ref: '429 with Retry-After', why: 'A test reads the status.' },
      { criterion: 1, kind: 'human', ref: 'a second suggestion for 1', why: 'ignored' },
      { criterion: 4, kind: 'test', ref: 'no such criterion', why: 'ignored' },
    ],
  };
  const round = sharpenRound(out, { criteria: 2, maxQuestions: 5, firstQuestion: 3, firstAssumed: 2 });

  test('keeps at most maxQuestions valid ones, material first, numbered after the earlier rounds', () => {
    expect(round.questions.map((x) => [x.id, x.material])).toEqual([
      ['Q3', true],
      ['Q4', true],
      ['Q5', false],
      ['Q6', false],
      ['Q7', false],
    ]);
    expect(round.questions[0]?.text).toBe('Do retries of a failed webhook count towards the limit?');
  });

  test('drops the invalid one and the one over the limit, each with its reason', () => {
    expect(round.dropped).toEqual([
      { text: 'Which file holds the limiter?', reason: 'the repository can answer it' },
      { text: 'Is the limit counted per tenant or per sender key?', reason: 'a round asks at most 5 questions' },
    ]);
  });

  test('numbers the assumed items and keeps one proof suggestion per criterion the task has', () => {
    expect(round.assumed).toEqual([{ id: 'A2', text: 'The window is 60 seconds.', why: 'Easy to change in config.' }]);
    expect(round.proofs.map((p) => [p.criterion, p.ref])).toEqual([[1, '429 with Retry-After']]);
  });
});

describe('sharpenState', () => {
  const ev = (seq: number, type: string, payload: Record<string, unknown>): StintEvent => ({ id: `01M5WBKEC0GGGGGGGGGGGG${String(seq).padStart(4, '0')}`, seq, ts: '2026-10-28T10:00:00Z', task: 'T-0001', vendor: 'daemon', type: type as StintEvent['type'], payload });
  const asked = sharpenRound(
    { version: 'stint.questions/1', questions: [q({ text: 'Do retries of a failed webhook count towards it?', changes: 'scope' }), good], assumed: [{ text: 'The window is 60 seconds.', why: 'Easy to change.' }], proofs: [{ criterion: 1, kind: 'test', ref: '429 with Retry-After', why: 'A test reads it.' }] },
    { criteria: 2, maxQuestions: 5, firstQuestion: 1, firstAssumed: 1 },
  );
  const task = { acceptance: ['429 with Retry-After', 'Other tenants are not affected'] };

  test('before any round nothing is open, and every criterion misses a proof', () => {
    expect(sharpenState([], task)).toMatchObject({ round: 0, questions: [], open: [], openMaterial: [], proofs: { missing: [1, 2] }, ready: false });
  });

  test('a round opens its questions; answers close them; accepted proofs on every criterion make it ready', () => {
    const events = [ev(1, 'sharpen.asked', { round: 1, ...asked, host: 'ollama', model: 'fake', cost: null })];
    expect(sharpenState(events, task)).toMatchObject({ round: 1, open: ['Q1', 'Q2'], openMaterial: ['Q1'], ready: false, proofs: { suggested: [{ criterion: 1, ref: '429 with Retry-After' }] } });
    events.push(ev(2, 'sharpen.answered', { question: 'Q1', option: 'Retries do not count', decision: 'D1', by: 'you' }));
    events.push(ev(3, 'sharpen.answered', { assumption: 'A1', text: '30 seconds', decision: 'D2', by: 'you' }));
    const s = sharpenState(events, { ...task, proofs: [{ criterion: 1, kind: 'test', ref: '429 with Retry-After' }] });
    expect(s.questions[0]?.answered).toEqual({ option: 'Retries do not count', decision: 'D1', by: 'you' });
    expect(s.assumed[0]?.changed).toEqual({ text: '30 seconds', decision: 'D2', by: 'you' });
    expect(s).toMatchObject({ open: ['Q2'], openMaterial: [], proofs: { missing: [2] }, ready: false });
    const proofs = [
      { criterion: 1, kind: 'test' as const, ref: '429 with Retry-After' },
      { criterion: 2, kind: 'human' as const, ref: 'A second tenant still gets 200' },
    ];
    // an open question that is not material does not keep the task from being ready
    expect(sharpenState(events, { ...task, proofs })).toMatchObject({ open: ['Q2'], ready: true, proofs: { missing: [] } });
  });
});

test('A sharpen round costs money under the role sharpen, in the week and in the task total', async () => {
  const { dir, cleanup } = tempDir('stint-sharpen-cost-');
  try {
    const ws = await Workspace.open(dir);
    const t = await ws.createTask({ id: 'T-0001', title: 'Sharpen cost', goal: 'Count the sharpen call.', acceptance: ['counted'], testCommand: 'true', baseCommit: 'be1bee8d153659647701b8f5886f0a5c73cf276a' });
    await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'sharpen.asked', payload: { round: 1, questions: [], assumed: [], proofs: [], dropped: [], host: 'meta-api', model: 'muse-wonder-1.0', cost: { inputTokens: 2000, cachedTokens: 0, outputTokens: 300, usd: 0.014 } } });
    expect((await costs(ws, { group: 'run' })).map((r) => [r.key, r.usd, r.runs])).toEqual([['T-0001/sharpen', 0.014, 0]]);
    expect((await costs(ws, { group: 'model' })).find((r) => r.key === 'meta-api/muse-wonder-1.0')).toMatchObject({ usd: 0.014, roles: ['sharpen'] });
    expect((await costs(ws, { group: 'task' })).map((r) => [r.key, r.usd, r.runs])).toEqual([[t.id, 0.014, 0]]);
  } finally {
    cleanup();
  }
});
