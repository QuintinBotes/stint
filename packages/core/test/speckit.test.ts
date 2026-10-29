import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Draft, parseSpecKit, toSpecKit } from '../src/index';
import { example } from './ajv';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', 'speckit', `${name}.md`), 'utf8');
const SPEC = fixture('spec-template');
const TASKS = fixture('tasks-template');

function draftOf(spec: string, tasks?: string): Draft {
  const r = parseSpecKit(spec, tasks);
  if (!r.ok) throw new Error(r.problems.join('\n'));
  return r.draft;
}

const problemsOf = (spec: string, tasks?: string) => {
  const r = parseSpecKit(spec, tasks);
  return r.ok ? [] : r.problems;
};

describe('parseSpecKit', () => {
  test("Spec Kit's own spec template becomes a draft with its stories, scenarios, FR and SC ids, open items and the section Stint has no field for", () => {
    const d = draftOf(SPEC);
    expect(d).toMatchObject({ version: 'stint.draft/1', input: '$ARGUMENTS', kind: 'goal', kindReason: 'It has 3 user stories, and each ships on its own.', title: '[FEATURE NAME]', summary: '$ARGUMENTS' });
    expect(d.stories.map((s) => [s.title, s.priority, s.scenarios.length])).toEqual([
      ['[Brief Title]', 'P1', 2],
      ['[Brief Title]', 'P2', 1],
      ['[Brief Title]', 'P3', 1],
    ]);
    expect(d.stories[0]?.scenarios[0]).toEqual({ given: '[initial state]', when: '[action]', then: '[expected outcome]' });
    expect(d.stories[0]?.why).toBe('[Describe this user journey in plain language] [Explain the value and why it has this priority level]');
    expect(d.requirements.map((r) => r.id)).toEqual(['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005', 'FR-006', 'FR-007']);
    expect(d.requirements[2]).toEqual({ id: 'FR-003', text: 'Users MUST be able to [key interaction, e.g., "reset their password"]' });
    expect(d.success.map((s) => s.id)).toEqual(['SC-001', 'SC-002', 'SC-003', 'SC-004']);
    expect(d.open).toEqual([
      { id: 'O1', text: 'auth method not specified - email/password, SSO, OAuth?' },
      { id: 'O2', text: 'retention period not specified' },
    ]);
    expect(d.edgeCases).toEqual(['What happens when [boundary condition]?', 'How does system handle [error scenario]?']);
    expect(d.assumptions).toHaveLength(5);
    expect(d.assumptions[4]).toBe('Key Entities: **[Entity 1]**: [What it represents, key attributes without implementation]; **[Entity 2]**: [What it represents, relationships to other entities]');
    expect(d).toMatchObject({ questions: [], assumed: [], answers: [], nonGoals: [] });
    expect(d.split).toBeUndefined();
  });

  test("a tasks.md's phases become the goal's split, one task per phase, each after the one before", () => {
    const d = draftOf(SPEC, TASKS);
    expect(d.kindReason).toBe('Its tasks.md splits the work into 6 phases.');
    expect(d.split?.map((t) => [t.title, t.acceptance.length, t.dependsOn])).toEqual([
      ['Setup (Shared Infrastructure)', 3, []],
      ['Foundational (Blocking Prerequisites)', 6, [0]],
      ['User Story 1 - [Title] (Priority: P1) 🎯 MVP', 8, [1]],
      ['User Story 2 - [Title] (Priority: P2)', 6, [2]],
      ['User Story 3 - [Title] (Priority: P3)', 5, [3]],
      ['Polish & Cross-Cutting Concerns', 6, [4]],
    ]);
    expect(d.split?.[0]).toEqual({ title: 'Setup (Shared Infrastructure)', goal: 'Project initialization and basic structure', acceptance: ['T001 Create project structure per implementation plan', 'T002 Initialize [language] project with [framework] dependencies', 'T003 [P] Configure linting and formatting tools'], covers: [1, 2, 3, 4], dependsOn: [] });
  });

  test('a phase with more than 8 tasks keeps 8 as checks and the rest in its goal', () => {
    const tasks = `## Phase 1: Everything\n\n**Goal**: All of it\n\n${Array.from({ length: 10 }, (_, i) => `- [ ] T00${i} Step ${i}`).join('\n')}\n`;
    const [phase] = draftOf(SPEC, tasks).split ?? [];
    expect(phase?.acceptance).toHaveLength(8);
    expect(phase?.goal).toBe('All of it\n\nAlso in this phase:\n- T008 Step 8\n- T009 Step 9');
  });

  test('a malformed file gives its problems in words, and no draft', () => {
    expect(parseSpecKit('Just some notes about a feature.')).toEqual({
      ok: false,
      problems: ['The spec has no title; Spec Kit starts it with # Feature Specification: Name.', 'The spec has no user stories; Spec Kit writes each as ### User Story 1 - Title (Priority: P1).'],
    });
    const story = (heading: string, body: string) => `# Feature Specification: Export\n\n## User Scenarios & Testing\n\n### ${heading}\n\n${body}\n`;
    expect(problemsOf(story('User Story 1 - Export (Priority: P1)', '1. When it runs, it works'))).toEqual([
      'User story 1 has "1. When it runs, it works", which is not a Given, When, Then scenario.',
      'User story 1 has no acceptance scenarios (1. **Given** ..., **When** ..., **Then** ...).',
    ]);
    expect(problemsOf(story('User Story 1 - Export', '1. **Given** a, **When** b, **Then** c'))).toEqual(['"### User Story 1 - Export" is not read as a user story: write it as ### User Story 1 - Title (Priority: P1).']);
    expect(problemsOf(story('User Story 1 - Export (Priority: P4)', '1. **Given** a, **When** b, **Then** c'))).toEqual(['User story 1 has priority P4; a draft uses P1, P2 or P3.']);
    const fr = (items: string[]) => `${story('User Story 1 - Export (Priority: P1)', '1. **Given** a, **When** b, **Then** c')}\n## Requirements\n\n### Functional Requirements\n\n${items.join('\n')}\n`;
    expect(problemsOf(fr(['- System MUST export'])))
      .toEqual(['The functional requirement "System MUST export" has no FR id; write it as - **FR-001**: text.']);
    expect(problemsOf(fr(Array.from({ length: 13 }, (_, i) => `- **FR-${String(i + 1).padStart(3, '0')}**: System MUST do ${i + 1}`)))).toEqual(['There are 13 functional requirements; a draft holds at most 12.']);
    expect(problemsOf(`${fr(['- **FR-001**: System MUST export'])}\n<!-- an unfinished note`)).toEqual(['The spec has a comment that starts with <!-- and never ends with -->.']);
    expect(problemsOf(SPEC, 'No phases here.')).toEqual(['tasks.md has no phases; Spec Kit writes each as ## Phase 1: Setup.']);
  });
});

describe('A page proof in a spec.md (R-068)', () => {
  const VISUAL = example('draft-visual') as Draft;

  test('is a short note under its scenario, and reads back as the same proof', () => {
    const lines = toSpecKit(VISUAL).split('\n');
    const at = lines.indexOf('1. **Given** a tenant over the limit, **When** an operator opens /admin, **Then** a banner says try again in 60 s');
    expect(lines.slice(at, at + 3)).toEqual(['1. **Given** a tenant over the limit, **When** an operator opens /admin, **Then** a banner says try again in 60 s', '   - **It looks right**: /admin :: a 429 banner saying try again in 60 s', '2. **Given** a tenant over the limit, **When** it sends a webhook, **Then** the reply is 429 with Retry-After 60']);
    // a held-out scenario is what no note means, so it reads back with no proof
    expect(draftOf(toSpecKit(VISUAL)).stories[0]?.scenarios.map((x) => x.proof ?? null)).toEqual([{ kind: 'visual', ref: '/admin :: a 429 banner saying try again in 60 s' }, null]);
  });

  test('a note that names no page, or stands under no scenario, is a problem in words', () => {
    const story = (body: string) => `# Feature Specification: Banner\n\n## User Scenarios & Testing\n\n### User Story 1 - Banner (Priority: P1)\n\n${body}\n`;
    const hint = 'write it under its scenario as - **It looks right**: /path :: what should be seen.';
    expect(problemsOf(story('1. **Given** a, **When** b, **Then** c\n   - **It looks right**: the banner'))).toEqual([`User story 1 has "- **It looks right**: the banner"; ${hint}`]);
    expect(problemsOf(story('- **It looks right**: /admin :: a banner\n1. **Given** a, **When** b, **Then** c'))).toEqual([`User story 1 has "- **It looks right**: /admin :: a banner"; ${hint}`]);
  });
});

describe('toSpecKit', () => {
  test('writes the draft in Spec Kit sections, with its open items as NEEDS CLARIFICATION markers', () => {
    const md = toSpecKit(example('draft') as Draft);
    const lines = md.split('\n');
    expect(lines.slice(0, 3)).toEqual(['# Feature Specification: Export reports as CSV', '', '**Input**: User description: "Let people export a report as CSV, and send it to them by email every Monday."']);
    expect(lines).toContain('### User Story 2 - Get the report by email every Monday (Priority: P2)');
    expect(lines).toContain('1. **Given** a report with 3 rows, **When** the person chooses Download CSV, **Then** a file with a header line and 3 rows is saved');
    expect(lines).toContain('- **SC-002**: Every subscribed person gets exactly one email each Monday.');
    expect(lines).toContain('- [NEEDS CLARIFICATION: Who may subscribe other people to a report?]');
  });

  test('parseSpecKit reads it back with every story, scenario, requirement and criterion, both from a model draft and from the template', () => {
    for (const d of [example('draft') as Draft, draftOf(SPEC)]) {
      const back = draftOf(toSpecKit(d));
      for (const field of ['title', 'summary', 'stories', 'requirements', 'success', 'edgeCases', 'nonGoals', 'open'] as const) expect(back[field]).toEqual(d[field]);
    }
  });
});
