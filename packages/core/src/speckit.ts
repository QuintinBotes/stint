// GitHub Spec Kit's spec.md and tasks.md read into a draft, and a draft written back as a spec.md (R-066), with no
// model call. The section headings, the story, scenario, FR and SC lines and the [NEEDS CLARIFICATION: ...] marker
// follow Spec Kit's templates/spec-template.md and templates/tasks-template.md. Summary, Non-Goals and Open
// Questions are Stint's own sections, so a draft's summary, non-goals and open items survive the round trip.
//
// Adapted from GitHub Spec Kit (https://github.com/github/spec-kit).
// MIT License. Copyright GitHub, Inc.
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright
// notice and this permission notice shall be included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
import type { z } from 'zod';
import { type Draft, DraftSchema, type DraftStory } from './schemas/draft';
import { visualRef } from './schemas/task';
import type { ProposedTask } from './schemas/goal';

export type SpecKitResult = { ok: true; draft: Draft } | { ok: false; problems: string[] };

type Block = { heading: string; lines: string[] };
type Part = Block & { subs: Block[] };

/** A heading as Spec Kit writes it, without its `*(mandatory)*` note, for matching. */
const norm = (heading: string) => heading.replace(/\*\([^)]*\)\*/g, '').trim().toLowerCase();
const bullets = (lines: string[]) => lines.flatMap((l) => (/^[-*]\s+/.test(l) ? [l.replace(/^[-*]\s+/, '').trim()] : []));
const paragraph = (lines: string[]) => lines.filter((l) => l && l !== '---').join(' ').trim();
const MARKER = /\[NEEDS CLARIFICATION:\s*([^\]]+?)\s*\]/g;
const STORY = /^User Story\s+\d+\s*[-:\u2013\u2014]\s*(.+?)\s*\(Priority:\s*(P\d+)\)/i;
/** Stint's note under a scenario proven by what a page shows; Spec Kit has no field for a proof. */
const LOOKS = /^[-*]\s+\*\*It looks right\*\*:\s*(.+)$/;
const SCENARIO = [/^\d+[.)]\s+\*\*Given\*\*\s+(.+?),?\s+\*\*When\*\*\s+(.+?),?\s+\*\*Then\*\*\s+(.+?)\s*$/i, /^\d+[.)]\s+Given\s+(.+?),?\s+when\s+(.+?),?\s+then\s+(.+?)\s*$/i];

/** Text without HTML comments, split into lines; an unclosed comment is a problem. */
function lines(text: string, file: string, problems: string[]): string[] {
  if (/<!--(?![\s\S]*?-->)/.test(text)) problems.push(`${file} has a comment that starts with <!-- and never ends with -->.`);
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd());
}

/** The text before the first `##`, then each `##` section with its `###` sections. */
function parts(all: string[]): { head: string[]; parts: Part[] } {
  const head: string[] = [];
  const out: Part[] = [];
  for (const l of all) {
    const h2 = /^##\s+(.+)$/.exec(l);
    const h3 = /^###\s+(.+)$/.exec(l);
    const at = out.at(-1);
    if (h2) out.push({ heading: (h2[1] as string).trim(), lines: [], subs: [] });
    else if (h3 && at) at.subs.push({ heading: (h3[1] as string).trim(), lines: [] });
    else if (at) (at.subs.at(-1) ?? at).lines.push(l.trim());
    else head.push(l.trim());
  }
  return { head, parts: out };
}

/** A section Stint has no field for, kept as one assumption: its heading and its text. */
const unknown = (heading: string, body: string[]) => {
  const text = body.map((l) => l.replace(/^[-*]\s+/, '')).filter((l) => l && l !== '---');
  return text.length ? [`${heading.replace(/\s*\*\([^)]*\)\*/g, '')}: ${text.join('; ')}`.slice(0, 300)] : [];
};

function story(b: Block, n: number, problems: string[]): DraftStory | null {
  const m = STORY.exec(b.heading);
  if (!m) {
    problems.push(`"### ${b.heading}" is not read as a user story: write it as ### User Story ${n} - Title (Priority: P1).`);
    return null;
  }
  const priority = m[2]?.toUpperCase() as string;
  if (!['P1', 'P2', 'P3'].includes(priority)) problems.push(`User story ${n} has priority ${priority}; a draft uses P1, P2 or P3.`);
  const scenarios: DraftStory['scenarios'] = [];
  const said: string[] = [];
  let why = '';
  for (const l of b.lines) {
    if (/^\d+[.)]\s/.test(l)) {
      const s = SCENARIO.map((r) => r.exec(l)).find(Boolean);
      if (s) scenarios.push({ given: s[1] as string, when: s[2] as string, then: s[3] as string });
      else problems.push(`User story ${n} has "${l.slice(0, 80)}", which is not a Given, When, Then scenario.`);
    } else if (LOOKS.test(l)) {
      const ref = l.replace(LOOKS, '$1').trim();
      const at = scenarios.at(-1);
      if (at && visualRef(ref)) at.proof = { kind: 'visual', ref };
      else problems.push(`User story ${n} has "${l.slice(0, 80)}"; write it under its scenario as - **It looks right**: /path :: what should be seen.`);
    } else if (/^\*\*Why this priority\*\*:/i.test(l)) why = l.replace(/^\*\*Why this priority\*\*:\s*/i, '');
    else if (l && l !== '---' && !/^\*\*(Independent Test|Acceptance Scenarios)\*\*:/i.test(l)) said.push(l);
  }
  if (!scenarios.length) problems.push(`User story ${n} has no acceptance scenarios (1. **Given** ..., **When** ..., **Then** ...).`);
  const title = (m[1] as string).trim();
  return { title, priority: priority as DraftStory['priority'], why: [...said, why].filter(Boolean).join(' ') || title, scenarios };
}

/** `- **FR-001**: text` as `{ id, text }`; a bullet without the id is a problem. */
function numbered(items: string[], prefix: 'FR' | 'SC', what: string, problems: string[]) {
  return items.flatMap((item) => {
    const m = new RegExp(`^\\**(${prefix}-\\d{3})\\**\\s*:?\\s*(.+)$`).exec(item);
    if (m) return [{ id: m[1] as string, text: (m[2] as string).trim() }];
    problems.push(`The ${what} "${item.slice(0, 80)}" has no ${prefix} id; write it as - **${prefix}-001**: text.`);
    return [];
  });
}

/** tasks.md's phases as a goal's split: one task per phase, each waiting on the phase before it. */
function phases(text: string, covers: number[], problems: string[]): ProposedTask[] {
  const all = lines(text, 'tasks.md', problems);
  const out: ProposedTask[] = [];
  let at: { title: string; goal: string; tasks: string[] } | null = null;
  const done = () => {
    if (!at) return;
    if (!at.tasks.length) problems.push(`tasks.md's phase "${at.title}" has no tasks (- [ ] T001 ...).`);
    const rest = at.tasks.slice(8);
    const goal = [at.goal, rest.length ? `Also in this phase:\n${rest.map((t) => `- ${t}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
    out.push({ title: at.title, goal: goal.slice(0, 2000), acceptance: at.tasks.slice(0, 8), covers, dependsOn: out.length ? [out.length - 1] : [] });
    at = null;
  };
  for (const l of all) {
    const phase = /^##\s+Phase\s+\S+?\s*:\s*(.+)$/i.exec(l);
    if (phase) {
      done();
      at = { title: (phase[1] as string).trim(), goal: '', tasks: [] };
    } else if (/^##\s/.test(l)) done();
    else if (at) {
      const task = /^[-*]\s+\[[ xX]\]\s+(.+)$/.exec(l.trim());
      const goal = /^\*\*(Goal|Purpose)\*\*:\s*(.+)$/i.exec(l.trim());
      if (task) at.tasks.push((task[1] as string).trim().slice(0, 300));
      else if (goal && !at.goal) at.goal = (goal[2] as string).trim();
    }
  }
  done();
  for (const p of out) p.goal ||= p.title;
  if (!out.length) problems.push('tasks.md has no phases; Spec Kit writes each as ## Phase 1: Setup.');
  return out;
}

const NOUNS: Record<string, string> = {
  stories: 'user stories',
  requirements: 'functional requirements',
  success: 'success criteria',
  edgeCases: 'edge cases',
  assumptions: 'assumptions, counting each section Stint has no place for as one',
  nonGoals: 'non-goals',
  open: 'items marked NEEDS CLARIFICATION',
  split: 'phases in tasks.md',
};

/** A schema issue in words: a count over the limit, a line too long, or the field and zod's own words. */
function plain(issue: z.core.$ZodIssue, raw: Record<string, unknown>): string {
  const field = String(issue.path[0]);
  if (issue.code === 'too_big' && issue.origin === 'array' && issue.path.length === 1) return `There are ${(raw[field] as unknown[]).length} ${NOUNS[field] ?? field}; a draft holds at most ${issue.maximum}.`;
  const where = issue.path.map((p) => (typeof p === 'number' ? p + 1 : String(p))).join(' ');
  if (issue.code === 'too_big' && issue.origin === 'string') return `${where} is longer than ${issue.maximum} characters.`;
  return `${where}: ${issue.message}`;
}

/**
 * A draft from a Spec Kit spec.md, and its tasks.md if given, whose phases become the goal's split. No model is
 * asked. A section Stint has no field for is kept as an assumption; a file it cannot read gives its problems in words.
 */
export function parseSpecKit(spec: string, tasks?: string): SpecKitResult {
  const problems: string[] = [];
  const all = lines(spec, 'The spec', problems);
  const { head, parts: sections } = parts(all);
  const title = /^#\s+(?:Feature Specification:\s*)?(.+)$/.exec(head.find((l) => /^#\s/.test(l)) ?? '')?.[1]?.trim() ?? '';
  if (!title) problems.push('The spec has no title; Spec Kit starts it with # Feature Specification: Name.');
  const input = /^\*\*Input\*\*:\s*(?:User description:\s*)?"?(.+?)"?$/.exec(head.find((l) => /^\*\*Input\*\*:/.test(l)) ?? '')?.[1]?.trim() ?? '';

  const stories: DraftStory[] = [];
  const d = { summary: '', edgeCases: [] as string[], requirements: [] as Draft['requirements'], success: [] as Draft['success'], assumptions: [] as string[], nonGoals: [] as string[] };
  const kept: string[] = [];
  for (const p of sections) {
    const h = norm(p.heading);
    if (h === 'user scenarios & testing') {
      for (const s of p.subs) {
        if (norm(s.heading) === 'edge cases') d.edgeCases.push(...bullets(s.lines));
        else if (/^user story\b/i.test(s.heading)) {
          const one = story(s, stories.length + 1, problems);
          if (one) stories.push(one);
        } else kept.push(...unknown(s.heading, s.lines));
      }
    } else if (h === 'requirements') {
      const fr = p.subs.filter((s) => norm(s.heading) === 'functional requirements');
      d.requirements.push(...numbered(bullets([...p.lines, ...fr.flatMap((s) => s.lines)]), 'FR', 'functional requirement', problems));
      for (const s of p.subs.filter((x) => !fr.includes(x))) kept.push(...unknown(s.heading, s.lines));
    } else if (h === 'success criteria') d.success.push(...numbered(bullets([...p.lines, ...p.subs.flatMap((s) => s.lines)]), 'SC', 'success criterion', problems));
    else if (h === 'assumptions') d.assumptions.push(...bullets(p.lines));
    else if (h === 'summary') d.summary = paragraph(p.lines);
    else if (h === 'non-goals' || h === 'out of scope') d.nonGoals.push(...bullets(p.lines));
    else if (h !== 'open questions') kept.push(...unknown(p.heading, [...p.lines, ...p.subs.flatMap((s) => [s.heading, ...s.lines])]));
  }
  if (!stories.length && !problems.some((x) => x.startsWith('"###'))) problems.push('The spec has no user stories; Spec Kit writes each as ### User Story 1 - Title (Priority: P1).');
  const open = [...new Set([...all.join('\n').matchAll(MARKER)].map((m) => m[1] as string))].map((text, i) => ({ id: `O${i + 1}`, text: text.slice(0, 300) }));
  const split = tasks === undefined ? undefined : phases(tasks, d.success.map((_, i) => i + 1), problems);
  const goal = stories.length > 1 || split !== undefined;
  const raw = {
    version: 'stint.draft/1',
    input: input || title || 'A Spec Kit spec',
    kind: goal ? 'goal' : 'task',
    kindReason: split ? `Its tasks.md splits the work into ${split.length} phases.` : goal ? `It has ${stories.length} user stories, and each ships on its own.` : 'It has one user story.',
    title,
    summary: d.summary || input || title,
    stories,
    requirements: d.requirements,
    success: d.success,
    edgeCases: d.edgeCases,
    assumptions: [...d.assumptions, ...kept],
    nonGoals: d.nonGoals,
    open,
    questions: [],
    assumed: [],
    answers: [],
    ...(split ? { split } : {}),
  };
  if (problems.length) return { ok: false, problems };
  const parsed = DraftSchema.safeParse(raw);
  return parsed.success ? { ok: true, draft: parsed.data } : { ok: false, problems: parsed.error.issues.map((i) => plain(i, raw)) };
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ');
const list = (heading: string, items: string[]) => (items.length ? [heading, '', ...items.map((i) => `- ${oneLine(i)}`), ''] : []);

/** A draft as a Spec Kit spec.md a person can keep in their repository; parseSpecKit reads it back to the same spec. */
export function toSpecKit(d: Draft): string {
  const stories = d.stories.flatMap((s, i) => [
    `### User Story ${i + 1} - ${oneLine(s.title)} (Priority: ${s.priority})`,
    '',
    `**Why this priority**: ${oneLine(s.why)}`,
    '',
    '**Acceptance Scenarios**:',
    '',
    ...s.scenarios.flatMap((x, n) => [`${n + 1}. **Given** ${oneLine(x.given)}, **When** ${oneLine(x.when)}, **Then** ${oneLine(x.then)}`, ...(x.proof?.kind === 'visual' && x.proof.ref ? [`   - **It looks right**: ${oneLine(x.proof.ref)}`] : [])]),
    '',
    '---',
    '',
  ]);
  return [
    `# Feature Specification: ${oneLine(d.title)}`,
    '',
    `**Input**: User description: "${oneLine(d.input)}"`,
    '',
    '**Status**: Draft',
    '',
    '## Summary',
    '',
    d.summary,
    '',
    '## User Scenarios & Testing *(mandatory)*',
    '',
    ...stories,
    ...list('### Edge Cases', d.edgeCases),
    '## Requirements *(mandatory)*',
    '',
    ...list('### Functional Requirements', d.requirements.map((r) => `**${r.id}**: ${r.text}`)),
    '## Success Criteria *(mandatory)*',
    '',
    ...list('### Measurable Outcomes', d.success.map((s) => `**${s.id}**: ${s.text}`)),
    ...list('## Assumptions', d.assumptions),
    ...list('## Non-Goals', d.nonGoals),
    ...list('## Open Questions', d.open.map((o) => `[NEEDS CLARIFICATION: ${o.text}]`)),
  ].join('\n');
}
