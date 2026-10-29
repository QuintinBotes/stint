import { describe, expect, test } from 'bun:test';
import { type Draft, type DraftOutput, type ModelQuestion, draftFromOutput, draftProblem, goalFromDraft, mergeAnswers, taskFromDraft } from '../src/index';
import { example } from './ajv';

const EXAMPLE = example('draft') as Draft;
const asTask: Draft = { ...EXAMPLE, kind: 'task', split: undefined };
delete asTask.split;

const question = (text: string, changes: string, safe: boolean): ModelQuestion => ({
  text,
  changes,
  evidence: 'The input does not say.',
  options: [
    { label: 'Only themselves', consequence: 'Each person subscribes on their own.' },
    { label: 'Anyone', consequence: 'People add colleagues.' },
  ],
  recommendation: { option: 'Only themselves', why: 'No one gets mail they did not ask for.' },
  safeDefault: safe ? { exists: true, option: 'Only themselves' } : { exists: false },
  blocks: [1],
  material: false,
});

const output = (patch: Partial<DraftOutput> = {}): DraftOutput => ({
  kind: 'task',
  kindReason: 'One story.',
  title: 'Export reports as CSV',
  summary: 'A person can download a report as CSV.',
  stories: [{ title: 'Download', priority: 'P1', why: 'Most people only need the file.', scenarios: [{ given: 'a report', when: 'the person downloads it', then: 'a CSV is saved' }] }],
  requirements: [],
  success: [{ id: 'SC-001', text: 'A 10,000 row report downloads in under 5 seconds.' }],
  edgeCases: [],
  assumptions: [],
  nonGoals: [],
  open: [{ id: 'O1', text: 'Who may subscribe other people?' }],
  questions: [question('Who may subscribe other people to a report?', 'authority', false), question('Which file holds the export code?', 'implementation', true)],
  assumed: [{ text: 'The CSV uses commas.', why: 'Spreadsheets open it.' }],
  ...patch,
});

describe('A draft from the model', () => {
  test("keeps the questions that pass Sharpen's rules, drops one the repository can answer, and lets the person's kind stand", () => {
    const d = draftFromOutput(output(), { input: 'Export reports', questions: [], assumed: [], answers: [], kind: 'goal' }, 5);
    expect(d.questions.map((q) => [q.id, q.round, q.material, q.text])).toEqual([['Q1', 1, true, 'Who may subscribe other people to a report?']]);
    expect(d).toMatchObject({ version: 'stint.draft/1', input: 'Export reports', kind: 'goal', kindReason: 'You asked for a goal.', assumed: [{ id: 'A1', text: 'The CSV uses commas.' }], open: [{ id: 'O1' }] });
  });

  test('numbers a second round after the first, and a call past the second asks nothing and lists what is still open as assumed', () => {
    const first = draftFromOutput(output(), { input: 'Export reports', questions: [], assumed: [], answers: [] }, 5);
    const second = draftFromOutput(output(), first, 5);
    expect(second.questions.map((q) => [q.id, q.round])).toEqual([
      ['Q1', 1],
      ['Q2', 2],
    ]);
    expect(second.assumed.map((a) => a.id)).toEqual(['A1', 'A2']);
    const third = draftFromOutput(output(), second, 5);
    expect(third.questions.map((q) => q.id)).toEqual(['Q1', 'Q2']);
    expect(third.open).toEqual([]);
    expect(third.assumed.slice(2)).toEqual([
      { id: 'A3', text: 'The CSV uses commas.', why: 'Spreadsheets open it.' },
      { id: 'A4', text: 'Still open: Who may subscribe other people?', why: 'Still open after 2 rounds of questions; change it on the task if it matters.' },
    ]);
  });
});

describe('Answers', () => {
  test('a later answer to the same question replaces the earlier one', () => {
    expect(mergeAnswers([{ question: 'Q1', choice: 'Anyone' }, { question: 'Q2', text: 'Weekly' }], [{ question: 'Q1', choice: 'Only themselves' }])).toEqual([
      { question: 'Q1', choice: 'Only themselves' },
      { question: 'Q2', text: 'Weekly' },
    ]);
  });

  test('a draft cannot be created with an answer to no question, a choice that is not an option, or a goal without success criteria', () => {
    expect(draftProblem(EXAMPLE)).toBeNull();
    expect(draftProblem({ ...EXAMPLE, answers: [{ question: 'Q9', choice: 'Only themselves' }] })).toBe('Q9 is not a question of this draft');
    expect(draftProblem({ ...EXAMPLE, answers: [{ question: 'Q1', choice: 'Everyone' }] })).toBe('"Everyone" is not an option of Q1; its options are Only themselves, Anyone who can see the report');
    expect(draftProblem({ ...EXAMPLE, success: [] })).toBe('a goal needs at least one success criterion (SC-001)');
  });
});

describe('What a draft becomes', () => {
  test('a task: one acceptance line per scenario, P1 first, each proven by its scenario, with the requirements and non-goals in its goal', () => {
    const p2First = { ...asTask, stories: [EXAMPLE.stories[1], EXAMPLE.stories[0]] } as Draft;
    expect(taskFromDraft(p2First)).toEqual({
      title: 'Export reports as CSV',
      goal: 'A person can download any report as a CSV file, and can ask for it by email every Monday. Today reports can only be read on screen.\n\nRequirements:\n- FR-001: System MUST write CSV with a header line and one line per row.\n- FR-002: System MUST send the weekly email at most once per person per report.\n\nNot in scope:\n- Excel files\n- Daily or monthly emails',
      acceptance: [
        'Given a report with 3 rows, when the person chooses Download CSV, then a file with a header line and 3 rows is saved',
        'Given an empty report, when the person chooses Download CSV, then a file with only the header line is saved',
        'Given a person subscribed to a report, when Monday 08:00 in their time zone passes, then one email with the CSV attached is sent to them',
      ],
      proofs: [
        { criterion: 1, kind: 'scenario', ref: 'a file with a header line and 3 rows is saved' },
        { criterion: 2, kind: 'scenario', ref: 'a file with only the header line is saved' },
        { criterion: 3, kind: 'scenario', ref: 'one email with the CSV attached is sent to them' },
      ],
    });
  });

  test("a task keeps the task schema's twelve acceptance lines and the rest as requirements in its goal", () => {
    const scenarios = Array.from({ length: 5 }, (_, i) => ({ given: `state ${i}`, when: 'it runs', then: `result ${i}` }));
    const many = { ...asTask, requirements: [], nonGoals: [], stories: [1, 2, 3].map((n) => ({ title: `Story ${n}`, priority: 'P1' as const, why: 'It matters.', scenarios })) };
    const t = taskFromDraft(many);
    expect(t.acceptance).toHaveLength(12);
    expect(t.proofs.at(-1)).toEqual({ criterion: 12, kind: 'scenario', ref: 'result 1' });
    expect(t.goal).toBe(`${EXAMPLE.summary}\n\nRequirements:\n- Given state 2, when it runs, then result 2\n- Given state 3, when it runs, then result 3\n- Given state 4, when it runs, then result 4`);
  });

  test("a goal: its outcome, criteria and non-goals, and a split of one task per story, P1 first, unless tasks.md gave one", () => {
    const g = goalFromDraft(EXAMPLE);
    expect(g).toMatchObject({ title: 'Export reports as CSV', criteria: ['A report of 10,000 rows downloads in under 5 seconds.', 'Every subscribed person gets exactly one email each Monday.'], nonGoals: ['Excel files', 'Daily or monthly emails'] });
    expect(g.outcome.startsWith(`${EXAMPLE.summary}\n\nRequirements:\n- FR-001: `)).toBe(true);
    expect(g.split).toEqual(EXAMPLE.split as NonNullable<Draft['split']>);
    const p2First = { ...asTask, kind: 'goal' as const, stories: [EXAMPLE.stories[1], EXAMPLE.stories[0]] } as Draft;
    expect(goalFromDraft(p2First).split).toEqual([
      {
        title: 'Download a report as CSV',
        goal: 'Download a report as CSV: Most people only need the file, and the email builds on it.',
        acceptance: ['Given a report with 3 rows, when the person chooses Download CSV, then a file with a header line and 3 rows is saved', 'Given an empty report, when the person chooses Download CSV, then a file with only the header line is saved'],
        covers: [1, 2],
        dependsOn: [],
      },
      {
        title: 'Get the report by email every Monday',
        goal: 'Get the report by email every Monday: People who check the numbers weekly stop opening the app for them.',
        acceptance: ['Given a person subscribed to a report, when Monday 08:00 in their time zone passes, then one email with the CSV attached is sent to them'],
        covers: [1, 2],
        dependsOn: [],
      },
    ]);
  });
});
