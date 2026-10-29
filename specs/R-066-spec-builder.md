# R-066 · The spec builder: say what you want, Stint drafts the spec

Day: 5 (29 to 30 Oct) · Owner: CC · Depends on: R-064 (Sharpen, goals), R-065 (dialog) · Fallback: draft and create a task only, no import · Cut order: import first, then export, then goal drafts

## Goal
Starting work today means filling a form: a title, a goal, the checks that prove it is done and a test command. A person has to know how to write a spec before Stint helps at all; Sharpen asks its questions only after the task exists, behind an unticked box, and goals start from a separate button. The owner wants one front door where AI drafts the spec or the goal with the person, in the spirit of their Orbit inquisition, using GitHub Spec Kit's spec format.

The spec builder is that door. The person writes one or two sentences. A Meta model drafts a spec in Spec Kit's shape and marks what it cannot know as open questions. Stint asks only the questions that change what gets built, each with a recommended answer, using Sharpen's rules. The person edits the draft and creates either one task or a goal that Stint then splits into tasks. A person who already wrote a Spec Kit spec can open it instead, and Stint turns it into the same draft without a model call.

## Context
- GitHub Spec Kit (github.com/github/spec-kit, MIT) is a set of prompts and templates for spec-driven development: specify, clarify, plan, tasks, implement. Its `templates/spec-template.md` has: a title and the person's input; prioritised user stories (P1 first, each independently testable) with Given/When/Then acceptance scenarios; edge cases; functional requirements `FR-001` ("System MUST ..."); key entities; measurable success criteria `SC-001`; assumptions; and open questions marked `[NEEDS CLARIFICATION: ...]`. Stint adopts the shape and the markers, not the Python CLI or its agent slash commands.
- R-064 gives `questionProblem`, `isMaterial` and `sharpenRound` in `packages/core/src/sharpen.ts`: a question must say what it changes (implementation, proof, scope, authority), carry options and a recommended one, and is rejected when the repository could answer it or when it asks permission. Security, money and deleting data are always asked. `task.proofs` and the decision ledger hold the answers.
- Goals: `POST /api/goals` (outcome, criteria, non-goals, limits), `POST /api/goals/:id/plan` (the split proposal), `POST /api/goals/:id/tasks`.
- Every model call's cost is recorded (D-060). A call that belongs to no task writes `cost.recorded` to the workspace log (`task: 'workspace'`) with `payload.for`.
- The planner route (`routes.planner`, Meta first) and `planMemory()` (similar tasks, decisions and findings) serve Sharpen today.

## Data
`stint.draft/1`, a zod schema in core with a kit JSON Schema in `/schemas`:
- `input`: the person's words.
- `kind`: `task` or `goal`, with `kindReason`, one sentence. A goal when the work has more than one independently shippable story or would take more than one task's limits.
- `title`, `summary` (what and why, two or three sentences).
- `stories`: up to 6, each `{ title, priority: 'P1' | 'P2' | 'P3', why, scenarios: [{ given, when, then }] }` (1 to 6 scenarios).
- `requirements`: up to 12 `{ id: 'FR-001', text }`; `success`: up to 8 `{ id: 'SC-001', text }`.
- `edgeCases`, `assumptions`, `nonGoals`: up to 8 strings each.
- `open`: the `[NEEDS CLARIFICATION]` items, each `{ id, text }`.
- `questions`: the Sharpen round over `open`, in R-064's question shape, already filtered by `sharpenRound`; `assumed`: the reversible details settled with a default, listed.
- `answers`: `{ question, choice | text }[]`, filled as the person answers.

Mapping on create:
- a task gets `title`, `goal` = summary, `acceptance` = one line per scenario ("Given ..., when ..., then ..."), capped at the task schema's limit with the rest kept as requirements in the goal text, `proofs` = one `scenario` or `human` proof per acceptance line as the model proposed, and `nonGoals`;
- a goal gets `outcome` = summary, `criteria` = the success criteria, `nonGoals`; its split proposal is seeded with one task per story, P1 first;
- every answer becomes a decision on the new task or goal (evidence: "spec builder"), so later runs keep it.

## Requirements
1. `draftSpec(input, kind?)` in the daemon: one planner-route call with a structured output for the draft and its questions, validated by the schema; the questions go through `sharpenRound`; the cost goes on a `cost.recorded` workspace event with `for: 'draft'`. Nothing else is written until the person creates.
2. `refineDraft(draft, answers)`: one call that folds the answers into the draft (open items resolved, scenarios and success criteria updated) and returns the next round of questions, if any. Two rounds at most; after that, what is still open is listed as assumed.
3. `parseSpecKit(markdown)`: a pure parser in core from a Spec Kit `spec.md` (and an optional `tasks.md`, whose phases become the goal's split) to a draft. No model call. Unknown sections are kept as assumptions; a malformed file returns the parse problems in plain words.
4. `toSpecKit(draft)`: the draft rendered back as a Spec Kit `spec.md`, so a person can keep it in their repo.
5. Routes: `POST /api/drafts` `{ input, kind? }`, `POST /api/drafts/refine` `{ draft, answers }`, `POST /api/drafts/import` `{ spec, tasks? }`, `POST /api/drafts/create` `{ draft }` returning the task or goal id, `POST /api/drafts/export` returning markdown. Replay mode refuses the model calls with a plain reason; import, export and create work.
6. The UI: one dialog, "What do you want done?", opened by n, New task, New goal (with kind set to goal) and the palette.
   - Step 1: a text box, then Draft it (primary), Open a Spec Kit spec, and Write it yourself (the existing form, unchanged, for people who know exactly what they want).
   - Step 2: the questions first, each with its options and the recommended one marked, answered with one click or a typed answer; Use the recommended answers settles all of them at once.
   - Step 3: the draft, editable: title, summary, stories with their scenarios, success criteria, non-goals, assumptions. Task or goal is a two-option switch preselected from `kind`, with `kindReason` beside it.
   - Footer: Create task or Create goal; Download spec.md. The dialog uses R-065's `Dialog` with `dirty` once anything is typed, pending guards on every call, and keeps everything on a failed call.
7. CLI: `stint draft "..."` prints the draft and its questions; `--answer <id>=<choice>`, `--recommended`, `--from spec.md [--tasks tasks.md]`, `--create`, and `--out spec.md` for export.
8. The fake agents used by the flows tests answer drafts by words in the input, like the other fakes.
9. Credit: the prompt file and README say the spec shape is adapted from GitHub Spec Kit (MIT), with the licence notice where its text is reused.

## Acceptance
1. Core unit tests: the draft schema and its kit JSON Schema agree; `parseSpecKit` turns Spec Kit's own template example into a draft with stories, scenarios, FR and SC ids and open items, and reports a malformed file; `toSpecKit(parseSpecKit(x))` keeps every story, scenario, requirement and criterion; the task and goal mappings give the expected fields.
2. Daemon tests with a fake model: a draft call records one `cost.recorded` workspace event with `for: 'draft'`; a question the repository could answer is dropped; two refine rounds at most; create writes the task or goal and one decision per answer; replay refuses drafting and allows import.
3. Flows browser tests: type a sentence, answer one question, use the recommended answer for the rest, edit a scenario, create a task, and the task view shows the acceptance lines and the decisions; the same path creates a goal whose split proposal lists one task per story; Open a Spec Kit spec with a pasted spec creates a goal; Escape with a draft asks Discard this draft?.
4. `bash scripts/check.sh` and `bun run test:ui` pass.
