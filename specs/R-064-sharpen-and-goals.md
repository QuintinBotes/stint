# R-064 · Sharpen a task before it starts, and goals above tasks

Day: 4 to 5 (29 to 30 Oct) · Owner: CC · Depends on: R-010, R-020, R-036, R-062, R-063 · Fallback: Part 1 only (Sharpen for a task, API, CLI and the task view panel) · Cut order: Part 2 first, then Part 1's autopilot hook

## Goal
Most failed agent work starts as an unclear task: no one said what done looks like, what is out of scope, or how a criterion is proven. Stint should help a person define and refine the work before an agent spends money on it. It does this the way a good lead would: by asking the few questions whose answers change what gets built or how it is proven, recommending an answer to each, settling the rest itself and saying so, and recording every answer as a decision that later runs keep. That is Part 1, **Sharpen**.

Part 2 adds **goals**: an outcome above tasks, with success criteria and limits for the whole goal. The planner splits a goal into tasks, and a goal's result rolls up from its tasks' outcome records (R-063).

The design follows the owner's Orbit inquisition (github.com/QuintinBotes/orbit):
- questions are validated in code;
- questions the repository can answer are rejected;
- material topics are always asked;
- reversible details are assumed and listed;
- each criterion needs a proof.

## Context
- The planner chain (`routes.planner`) and `planMemory()` give similar tasks and the decisions and findings on the named files (R-036). `walkChain` returns `{ value, host, model, cost }`.
- The decision ledger is `ws.decisions(task).append({ text, by, evidence })`, which returns a `D<n>` id. The packet and later prompts already carry a task's valid decisions.
- Calls that are not runs record their cost on the event the call writes, and `callsFromEvents` in `packages/core/src/project/index.ts` reads it (D-060).
- R-063 reads `task.proofs`. R-062 gives the `limits` shape and `taskUsage`.
- Autopilot's `nextStep` is a pure function of the log (R-025).

## Part 1: Sharpen a task

### Definitions
**A question is valid only if all of the following hold.** Check this in code, not by asking the model.
- Its `text` ends in "?" and has at least 5 words.
- `changes` is one of `implementation | proof | scope | authority`.
- `evidence` (what Stint found that raised it) is not empty.
- It has 2 to 4 `options` with distinct labels, each with a `consequence`.
- `recommendation` is one of the option labels, with a `why`.
- `safeDefault` is `{ exists: boolean, option?: label, why? }`.
- `blocks` lists the criterion indexes it affects (possibly none).
- It does not match the rejected patterns:
  - things the repository can answer, such as "which file", "what version", "where is", "does the repo", "what framework" (case-insensitive);
  - asks for permission or opinion, such as "should I proceed", "do you want me to", "any thoughts", "is that ok".
An invalid question is dropped and counted in `dropped`, with its reason.

**A question is material when** the model says so, or when the code finds:
- no safe default; or
- `changes` is `scope` or `authority`; or
- an option or the text matches security, auth, permissions, secrets, privacy or personal data, billing, payments, prices, money, deleting or dropping data, migrations, or irreversible effects.
The code can only upgrade a question to material, never downgrade it. Material questions are always asked. A non-material question can be settled with its recommendation, recorded as assumed.

**A round** asks at most `sharpen.maxQuestions` questions (default 5), material first. It also proposes `assumed` items (`{ id: A<n>, text, why }`), the reversible details Stint settled itself, and one `proofs` suggestion per criterion: `{ criterion, kind: test | scenario | check | human, ref, why }`.

**Ready** means no material question is open and every criterion has an accepted proof.

### Requirements
1. MUST add `schemas/questions.schema.json` (`stint.questions/1`, the model's output: `questions`, `assumed`, `proofs`), its zod mirror, an example, and the agreement test. Also add `task.proofs?: Array<{ criterion: int, kind, ref: string ≤200 }>` to `stint.task/1` in zod and in `schemas/task.schema.json`.
2. MUST implement `sharpen(ctx, taskId)` in `packages/daemon/src/sharpen.ts`. It calls the `routes.sharpen` chain, which falls back to `routes.planner`. The prompt includes:
   - the task's title, goal, acceptance, test command and checks;
   - `planMemory()`;
   - up to 200 tracked file paths;
   - the task's valid decisions;
   - the earlier rounds' questions and answers.
   It then validates and classifies the questions as defined above and writes `sharpen.asked { round, questions, assumed, proofs, dropped, host, model, cost }`. Add one line to `callsFromEvents` so the cost counts under the role `sharpen`.
3. MUST add the routes (daemon token required on POST):
   - `POST /api/tasks/:id/sharpen` starts a round. It answers 409 while a run is live.
   - `GET /api/tasks/:id/sharpen` returns `sharpenState()`.
   - `POST /api/tasks/:id/sharpen/answer { question | assumption, option?, text? }` records `sharpen.answered` with `vendor: 'human'` and appends a decision whose text pairs the question with the answer, with evidence `sharpen:<Q id>`. It returns the decision id.
   - `POST /api/tasks/:id/sharpen/recommended` answers every open non-material question with its recommendation.
   - `POST /api/tasks/:id/proofs { proofs }` writes `task.proofs` and records `proofs.set`.
   Add the new event types to `EVENT_TYPES` and `schemas/event.schema.json`.
4. MUST implement `sharpenState(events, task)` in core as a pure function returning `{ round, questions[] with answered?, open, openMaterial, assumed, proofs: accepted, suggested, missing, ready }`.
5. MUST add `config.sharpen = { beforeAutopilot: false, maxQuestions: 5 }`. With `beforeAutopilot` on:
   - `nextStep` returns `{ kind: 'sharpen' }` before `plan` when the task has no `sharpen.asked`;
   - after the round, it stops with `needsYou` ("Needs you: 2 questions to answer before it starts.") while material questions are open;
   - it answers non-material ones with the recommendation, recorded with `by: 'autopilot'`, and continues.
   It is off by default, so the replay, the demo and the existing flows are unchanged.
6. MUST put the answers in front of the agents. The planner prompt and the first build's ask include the task's sharpen decisions and accepted proofs. A test checks the planner prompt contains an answer.
7. MUST add the CLI commands:
   - `stint sharpen <task> [--json] [--recommended]`: interactive. It prints each question with lettered options, marks the recommended one, and reads a letter, free text, or Enter for the recommendation. `--recommended` takes recommendations for the non-material ones.
   - `stint answer <task> <Q1|A1> <letter|text>`.
   - `stint proofs <task> [--set 1=test:"429 with Retry-After"]`.
8. MUST show Sharpen in the task view, following DESIGN.md and WCAG 2.2 AA. Put it above the tabs, beside the existing "who continues" and queue rows.
   - **Starting:** before any run, a secondary button "Sharpen this task" with `Explain word="sharpen"`.
   - **One card per question:**
     - the question in body text;
     - "What Stint found:" and the evidence, in small text;
     - the options as a native radio group in a `fieldset` with a `legend`, lettered A to D, each with its consequence;
     - the recommended option carrying the `recommend` chip (an ink outline, never green);
     - the safe default;
     - which criteria it blocks;
     - a "Something else" text field and an Answer button.
     A material question carries an amber "Needs your answer". Answered cards collapse to one line showing the answer and its decision id.
   - **"Use the recommendations for the rest":** one button.
   - **"Assumed":** a list, each item with Change, which opens the same answer form.
   - **"Proofs":** one row per criterion with a kind select and a ref field, prefilled from the suggestions, and a "Use these proofs" button.
   - **Ready:** a ready line in ink: "Ready: every criterion has a proof and nothing waits on you."
   - Add `sharpen` to the glossary: "Before work starts, Stint asks the few questions whose answers change what gets built or how it is proven, recommends an answer to each, and records yours as decisions."
9. MUST give the New task dialog a "Sharpen it first" checkbox, off by default. When checked, creating the task opens it with a round started.
10. MUST update the docs: a new `docs/sharpen.md` (how questions are chosen, what is always asked, how answers become decisions, proofs, the CLI and config), a README paragraph, and the CLI list.

### Acceptance
- Unit tests on the validator:
  - a valid question passes;
  - each rule rejects its case (no "?", one option, a recommendation not among the options, empty evidence, "Which file holds the limiter?", "Should I proceed?");
  - material is upgraded by a keyword and by `changes: scope`, and never downgraded.
- A daemon test with a fake planner returning six questions, one of them invalid: `sharpen.asked` keeps five valid ones, material first, drops one with a reason, and records the cost. Answering Q1 writes `sharpen.answered` and a decision. `/recommended` answers the rest that are not material. Setting proofs writes `task.proofs`, and `sharpenState` reports ready.
- An autopilot test with `beforeAutopilot` on and an open material question: it stops with Needs you. Answering it and turning autopilot on again plans, and the plan prompt includes the answer.
- A CLI test: `stint sharpen --recommended --json` prints the round.
- An e2e flow: a new task with "Sharpen it first" shows the question cards; answering one by keyboard (Tab to the radio group, arrows, Enter on Answer) collapses it to its decision; "Use these proofs" leads to the ready line.
- Typecheck, the unit tests, the guard and the a11y spec pass.

## Part 2: Goals

### Requirements
1. MUST add `schemas/goal.schema.json` (`stint.goal/1`), its zod mirror, an example, and the agreement test. The shape:
   `{ version, id: G-\d{4}, title ≤120, outcome ≤2000, criteria: [{ text ≤300, proof?: { kind, ref } }] 1..12, nonGoals: string[] ≤8, limits?: { usd?, builds? }, status: draft | ready | running | done | abandoned, tasks: T-ids, decisions: [{ id, text, by, at }], createdAt, updatedAt }`
   Goals are stored at `.stint/goals/G-0001.json`, and their events go to the workspace log with `payload.goal`. Tasks get `goal?: G-id` in `stint.task/1`.
2. MUST add the goal routes: `POST /api/goals`, `GET /api/goals`, `GET /api/goals/:id`, and `POST /api/goals/:id/sharpen` plus its `answer` and `recommended` (the same engine and validator as Part 1, with the goal as the subject and answers in `goal.decisions`).
3. MUST add `POST /api/goals/:id/plan`, which asks the planner to split the goal into 1 to 6 tasks. Each task gets the criteria it covers and its `dependsOn`, and the person sees them before they are created. Then `POST /api/goals/:id/tasks` creates the tasks with `goal` set. Each task's decision ledger starts with the goal's decisions, and each task's limits take the goal's per-task share where the goal sets one.
4. MUST enforce goal limits. Before a build of a task with a goal, autopilot also checks the goal's total spend and builds across its tasks against `goal.limits`, and stops with `limit.reached { scope: 'goal' }` when the next build would pass them.
5. MUST implement `goalOutcome(goal, outcomes)` in core, which rolls up R-063's `outcome()` per task. Each goal criterion takes the weakest state of the task criteria it maps to. It also reports tasks by result, total spend against the limit, builds, merged count, and a result: done when every task is merged and every criterion is proven or checked by you.
6. MUST add the CLI: `stint goal new <title> --outcome … --criterion … [--non-goal …] [--max-usd D] [--max-builds N]`, `stint goal sharpen <G>`, `stint goal plan <G> [--yes]`, `stint goal show <G> [--json]`, `stint goal list`.
7. MUST add the web UI:
   - a "Goals" item in the top bar between Board and Factory;
   - `/goals`: a list showing title, status, "3 of 4 criteria met", tasks and spend;
   - `/goals/:id`: the outcome, the criteria with states, the same Sharpen panel, "Split into tasks" (proposed tasks shown, then "Create tasks"), the tasks with their results linking to each task, and the spend and build meters against the goal's limits;
   - "New goal" in the command palette and on the Goals page;
   - `goal` in the glossary: "An outcome bigger than one task, with the criteria that prove it. Stint splits it into tasks and shows how each part went."
8. MUST update the docs: a goals section in `docs/sharpen.md`, the README, and `docs/factory.md`.

### Acceptance
- Schema agreement tests and examples.
- A daemon test: create a goal, sharpen it with a fake planner, answer it, plan it into two tasks, create them, and check that each task carries `goal`, the goal's decisions and its criteria.
- A goal limit test: two tasks whose spend reaches `goal.limits.usd` stop the next build with `scope: 'goal'`.
- `goalOutcome` unit tests.
- An e2e flow: create a goal from the Goals page, split it, create the tasks, and see them listed on the goal with their results.

## Out of scope
Mid-run questions raised by repeated failure or a reviewer disagreeing (a later spec, reusing the same engine); answering questions remotely from a pull request; and Orbit's practices checklist.
