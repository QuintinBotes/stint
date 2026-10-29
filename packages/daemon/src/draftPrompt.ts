// The spec builder's prompts (R-066): a draft in the shape of GitHub Spec Kit's spec template, then Sharpen's rules
// (R-064) for the questions over what the draft cannot know. The shape below paraphrases Spec Kit's
// templates/spec-template.md: prioritised, independently testable user stories, Given/When/Then scenarios,
// FR-001 requirements, measurable SC-001 criteria, reasonable-default assumptions and NEEDS CLARIFICATION items.
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
import type { Draft, DraftKind } from '@stint-dev/core';

const list = (items: string[]) => (items.length ? items.join('\n') : '- none');

const SHAPE = `Write the spec in the shape of GitHub Spec Kit's spec template:
- title: a few words; summary: what and why, in two or three sentences;
- kind: "goal" when the work has more than one independently shippable story or is too big for one agent run, otherwise "task"; kindReason: one sentence saying why;
- stories: 1 to 6 user stories, ordered by importance as user journeys, P1 the most critical. Each is independently testable: built alone, it still delivers value. Give each a title, a priority (P1, P2 or P3), why it has that priority, and 1 to 6 acceptance scenarios, each as given (the initial state), when (the action) and then (the expected outcome), without the words Given, When and Then;
- proof on a scenario: {"kind":"visual","ref":"<path> :: <what should be seen>"} only when the scenario names a page of the app (a path such as /admin) and what a person sees there, as in "/admin :: a 429 banner saying try again in 60 s"; Stint opens that page after the tests pass and judges what is on screen. Leave proof out of every other scenario, and it becomes a held-out test the agent cannot see;
- requirements: functional requirements with ids FR-001, FR-002 and on, each a sentence such as "System MUST ..." or "Users MUST be able to ...";
- success: measurable, technology-agnostic success criteria with ids SC-001 and on;
- edgeCases: boundary conditions and error scenarios, as questions such as "What happens when ...?";
- assumptions: the reasonable defaults chosen where the person's words did not say;
- nonGoals: what is out of scope;
- open: each thing that neither the person's words nor the files settle and that changes what gets built, with ids O1, O2 and on (Spec Kit marks these [NEEDS CLARIFICATION: ...]). Do not guess these.`;

const rules = (max: number) => `Then ask about the open items the way Stint's Sharpen does: at most ${max} questions, and only those whose answers change what gets built (implementation), how a criterion is proven (proof), what is in or out of scope (scope), or who may decide or do something (authority). For each question:
- write it as a question of at least 5 words that ends in "?";
- say in evidence what in the person's words or the files raised it;
- give 2 to 4 options with distinct labels, each with its consequence;
- recommend one option by its exact label, and say why;
- say whether a safe default exists, an answer that is cheap to reverse later, and give its label;
- list in blocks the numbers of the success criteria the answer affects (SC-001 is 1);
- set material to true when a wrong answer is costly or hard to undo.
Never ask what the repository can answer (which file, what version, where something is, what framework), and never ask for permission or an opinion. Settle reversible details yourself and list them under assumed, each with why.`;

const files = (f: string[]) => `## Tracked files (the first ${f.length})
${list(f.map((x) => `- ${x}`))}`;

/** The first call: the person's words become a draft and round 1 of its questions. */
export function draftPrompt(i: { input: string; kind?: DraftKind; files: string[]; max: number }): string {
  return `You draft a spec for Stint before any task exists. Return only JSON matching the schema given with this prompt.

${SHAPE}

${rules(i.max)}

${files(i.files)}

## What the person wants
${i.input}
${i.kind ? `\nThe person asked for a ${i.kind}.\n` : ''}
## Ask
Draft the spec now, and ask round 1.`;
}

/** A later call: the answers are folded into the draft, and the next round is asked unless the last one was. */
export function refinePrompt(i: { draft: Draft; round: number; last: boolean; files: string[]; max: number }): string {
  const d = i.draft;
  const spec = { kind: d.kind, kindReason: d.kindReason, title: d.title, summary: d.summary, stories: d.stories, requirements: d.requirements, success: d.success, edgeCases: d.edgeCases, assumptions: d.assumptions, nonGoals: d.nonGoals, open: d.open };
  const asked = d.questions.map((q) => {
    const a = d.answers.find((x) => x.question === q.id);
    return `- ${q.id}: ${q.text} ${a ? `Answer: ${[a.choice, a.text].filter(Boolean).join(', ')}` : 'Not answered.'}`;
  });
  return `You refine a draft spec for Stint before any task exists. Return only JSON matching the schema given with this prompt.

Fold the person's answers into the draft: remove from open the items the answers settle, and change the stories, scenarios, requirements and success criteria the answers change. Keep the ids and the words of everything the answers do not touch, including what the person edited.

${SHAPE}

${i.last ? 'This was the last round of questions: return no questions.' : rules(i.max)}
List under assumed only what you settle now, not what is already settled.

${files(i.files)}

## What the person wants
${d.input}

## The draft
${JSON.stringify(spec)}

## Questions and answers
${list(asked)}

## Already settled
${list(d.assumed.map((a) => `- ${a.id}: ${a.text}`))}

## Ask
${i.last ? 'Fold the answers in now.' : `Fold the answers in now, and ask round ${i.round}: none that an earlier round asked.`}`;
}
