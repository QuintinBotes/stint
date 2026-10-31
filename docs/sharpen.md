# Sharpen and goals

This page covers the spec builder, which turns a sentence into a task or a goal; Sharpen, which settles a task's open questions before an agent spends money on it; and goals, which group tasks under one outcome.

Most agent work that goes wrong starts as an unclear task: nobody said what done looks like, what is out of scope, or how a criterion is proven. Sharpen asks only the questions whose answers change what gets built or how it is proven, recommends an answer to each, settles the rest itself and says so, and records every answer as a decision that later runs keep.

## Start from a sentence: the spec builder

Press n, or choose New task, New goal or the command palette, and Stint asks "What do you want done?". Write a sentence or two and choose Draft it. One call on the draft chain (`routes.draft`: Muse Spark 1.3 first, because a person is waiting at the dialog, with Muse Wonder 1.0 further down) drafts a spec in [GitHub Spec Kit](https://github.com/github/spec-kit)'s shape:

- a title and a summary;
- user stories with a priority (P1 first) and Given, When, Then scenarios;
- requirements (`FR-001`) and success criteria (`SC-001`);
- edge cases, assumptions, and what is not in scope;
- the open items Spec Kit marks `[NEEDS CLARIFICATION]`.

Its questions follow the same rules as a Sharpen round (below), so a question the repository could answer is dropped. The draft also says whether it is one task or a goal, and why.

The dialog asks the questions first, each with its recommended answer. "Use the recommended answers" settles only the questions that are not material; a material one needs its own answer. Your answers fold back into the draft with one more call, which may ask a second round of questions. After two rounds, anything still open is listed as assumed. You then edit the draft and choose Create task or Create goal, or Download spec.md to keep it in your repository.

On create:

- **A task** gets the summary as its goal (with the requirements and what is out of scope under it), and one acceptance line per scenario ("Given ..., when ..., then ..."). Each line gets a proof: a `scenario` proof, or a `visual` proof when the scenario is about what a person sees on a page. The draft proposes the kind and you can switch it; a Spec Kit `spec.md` carries a visual proof as an "It looks right" note under the scenario.
- **A goal** gets the summary and the requirements as its outcome, the success criteria as its criteria, and a split proposal to check before any task is made: one task per story, P1 first, or one per phase of an opened `tasks.md`.

The questions become the new task's or goal's first Sharpen round, and each answer becomes a decision with "spec builder" as its evidence, so the plan and every run keep it. Nothing is written before create, except what the calls cost: each records `cost.recorded { for: 'draft' }` on the workspace log.

Open a Spec Kit spec reads a `spec.md` you already have, and optionally its `tasks.md`, with no model call. A malformed file is refused with its problems in plain words. Write it yourself opens the plain New task form, or the New goal form for a goal. A replay calls no model, so it cannot draft, but it can open a spec, create and export.

| Command | What it does |
|---|---|
| `stint draft "<what you want>"` | Drafts a spec and prints it with its questions; `--goal` drafts a goal |
| `stint draft --from spec.md --tasks tasks.md` | Opens a Spec Kit spec instead, or a draft saved with `--json` |
| `stint draft ... --answer Q1=A --recommended` | Answers a question by letter or in your own words, once per answer; `--recommended` takes the recommendation for every open question that is not material |
| `stint draft ... --create` | Creates the task or the goal |
| `stint draft ... --out spec.md` | Writes the draft as a Spec Kit `spec.md` |

The routes (each POST needs the daemon token): `POST /api/drafts` (`{ input, kind? }`), `POST /api/drafts/refine` (`{ draft, answers }`), `POST /api/drafts/import` (`{ spec, tasks? }`), `POST /api/drafts/create` (`{ draft }`, answers with the new id) and `POST /api/drafts/export` (the markdown). The draft is `stint.draft/1` ([`schemas/draft.schema.json`](../schemas/draft.schema.json)).

## How a round works

A round is one call to the sharpen chain: `routes.sharpen` when it is set, else the planner chain (the task's own planner route wins over the config's). The prompt carries:

- the task's title, goal, numbered acceptance criteria, test command and checks;
- from the memory, the similar tasks and the decisions and findings on the files the task names;
- up to 200 tracked file paths;
- the task's valid decisions;
- every earlier round's questions and answers.

The model answers in `stint.questions/1` ([`schemas/questions.schema.json`](../schemas/questions.schema.json)): questions, assumed items and proof suggestions. The schema checks only the shape. Code checks every rule below (`questionProblem` in `packages/core/src/sharpen.ts`), so one bad question is dropped and the rest are kept.

A question is kept only if:

- its text ends in "?" and has at least 5 words;
- `changes` is `implementation`, `proof`, `scope` or `authority`;
- `evidence`, what Stint found that raised the question, is not empty;
- it has 2 to 4 options with distinct labels, each with a consequence;
- its recommendation is one of the option labels, with a reason;
- its safe default, when it names an option, names one of them;
- the criteria it blocks exist on the task (numbered from 1);
- the repository cannot answer it: no "which file", "what version", "where is", "does the repo" or "what framework";
- it asks for a decision, not permission or an opinion: no "should I proceed", "do you want me to", "any thoughts" or "is that ok".

A dropped question is listed in the round's `dropped` with its reason. A round keeps at most `sharpen.maxQuestions` questions (5 by default), material ones first, and drops any beyond that with that reason. Questions are numbered `Q1`, `Q2` and so on across rounds, and assumed items `A1`, `A2` and so on.

## What is always asked

A question is material when the model says so, or when the code finds:

- no safe default (an answer that is cheap to reverse later);
- `changes` is `scope` or `authority`;
- the text or an option mentions security, auth, permissions, secrets, privacy or personal data, billing, payments, prices, money, deleting or dropping data, migrations, or something irreversible.

The code can only make a question material, never the reverse. A material question is always asked and carries "Needs your answer". A question that is not material can be settled with its recommendation: "Use the recommendations for the rest" in the task view, `stint sharpen --recommended`, or autopilot when it sharpens first.

The reversible details Stint settled itself are listed as **Assumed**, each with the reason. Change one, and your words replace it.

## Answers become decisions

In the task view each open question is a card, with its options as a radio group and the recommended one selected. "Answer with B" answers with the selected option, and "Answer with this" with your own words.

Every answer is a `sharpen.answered` event and a decision in the task's `decisions.md` that pairs the question with the answer, for example "Do retries of a failed webhook count towards the limit? Answer: Retries do not count", with `sharpen:Q2` as its evidence. A recommendation taken without asking says "(the recommendation)" and is recorded by whoever took it: you, or `autopilot`. Answering a question again, or changing an assumption again, supersedes the earlier decision; nothing is edited.

The planner prompt carries these decisions, the assumptions nobody changed, and the accepted proofs, under "Before work started". The first build's ask carries the same lines. A task that was never sharpened gets the same prompts as before.

## Proofs

Each criterion gets one proof, numbered from 1 like the acceptance lines:

| Kind | `ref` names |
|---|---|
| `test` | a test name or part of one; the test should fail before the change and pass after it |
| `scenario` | a held-out scenario |
| `check` | a check, such as `typecheck` |
| `visual` | a page and what should be seen there, as `<path> :: <what should be seen>`; Muse Spark 1.3 judges a screenshot of it ([`verify.md`](verify.md#what-stint-saw-visual-checks)) |
| `human` | what a person looks at before approving |

A round suggests one proof per criterion. Accepted proofs live in `task.json` as `proofs`, and the outcome record reads them. "Use these proofs" in the task view, or `stint proofs --set`, accepts them and records `proofs.set`. In the task view the kinds read A test, A scenario, A check, It looks right and You check it. `stint proofs --set` takes `test`, `scenario`, `check` or `human`; set a `visual` proof in the task view.

A task is **ready** when no material question is open and every criterion has an accepted proof.

## Autopilot

With `sharpen.beforeAutopilot` on, autopilot sharpens a task before it plans it. After the round, while material questions are open, it stops with "Needs you: 2 questions to answer before it starts." Once you have answered them and switched autopilot on again, it takes the recommendation for the rest, as `autopilot`, and plans. If no model can answer the round, autopilot says so and plans without questions. The setting is off by default, so the replay and the demo are unchanged.

## The CLI

| Command | What it does |
|---|---|
| `stint sharpen <task>` | Starts a round when nothing is open, then asks each open question: type a letter, your own words, or Enter for the recommendation |
| `stint sharpen <task> --recommended` | Takes the recommendation for every question that is not material, then asks the material ones |
| `stint sharpen <task> --json` | Prints the sharpen state and asks nothing |
| `stint answer <task> Q1 B` | Answers Q1 with option B; any other words are an answer of their own |
| `stint answer <task> A1 "The window is 30 seconds"` | Changes an assumption |
| `stint proofs <task>` | Lists each criterion with its accepted or suggested proof |
| `stint proofs <task> --set 1=test:"429 with Retry-After"` | Sets a proof; separate several with ";" |

The routes behind them (each POST needs the daemon token): `POST /api/tasks/:id/sharpen` starts a round (409 while a run is live), `GET /api/tasks/:id/sharpen` returns the state, `POST /api/tasks/:id/sharpen/answer` takes `{ question | assumption, option?, text? }` and returns the decision id, `POST /api/tasks/:id/sharpen/recommended` takes the recommendations, and `POST /api/tasks/:id/proofs` takes `{ proofs }`.

## Config

```json
"sharpen": { "beforeAutopilot": false, "maxQuestions": 5 },
"routes": { "sharpen": ["meta-api/muse-wonder-1.0"] }
```

`maxQuestions` is 1 to 10. A round's cost is recorded on `sharpen.asked` and counts in the week under the role "sharpens tasks", like the other model calls that are not runs. A task's round also counts in the task's spend, and so against its spend limit.

## Goals

A goal is an outcome bigger than one task, with the criteria that prove it and limits for all of its tasks. It is `stint.goal/1` ([`schemas/goal.schema.json`](../schemas/goal.schema.json)), stored at `.stint/goals/G-0001.json` and written only by the daemon. Its events go to the workspace log, `.stint/workspace/events.jsonl`, each with the goal's id in `payload.goal`: `goal.created`, `sharpen.asked`, `sharpen.answered`, `proofs.set`, `goal.planned`, `goal.tasks_created`, `goal.status` and `limits.changed`.

### Sharpening a goal

Sharpening a goal uses the same engine and rules as a task. The goal's criteria take the place of acceptance, and the prompt carries its title, outcome, criteria, what is not in scope, the tracked files, its decisions and the earlier rounds. Answers go to `goal.decisions` as `D1`, `D2` and so on. Answering a question again adds a decision, and the latest answer stands. Accepted proofs go on the goal's criteria.

### Status

A goal is `draft` until it is sharpened, no material question is open, and each criterion has a proof; then it is `ready`. Choosing "Split into tasks" also makes a draft ready. It is `running` once tasks are made from it, and `done` once its rollup says so. Only a person abandons a goal: "Abandon this goal" on its page says what will happen, and a second click does it. Its tasks stay as they are, and an abandoned goal can no longer be split into tasks.

### Splitting it into tasks

Splitting asks the planner chain for 1 to 6 tasks, each with a title, a goal, acceptance, the goal criteria it covers (numbered from 1) and the earlier tasks it waits for. The split is only a proposal: `goal.planned` records it and what the call cost (counted under the role "plans"), and no task exists yet. You check the proposed tasks, change a title or a check, then create them. A proposal made meanwhile in another tab or the CLI never replaces rows you are editing. Each task is made through the normal task path with:

- `goalId`, and `goalCriteria` for the goal criteria it covers;
- `dependsOn`, so it starts only once the tasks it waits for are merged;
- its share of the goal's spend and builds as its own limits;
- a ledger that starts with the goal's standing decisions, recorded by `goal` with `goal:G-0001/D1` as evidence; the plan and the first build carry them under "Before work started";
- for each covered goal criterion that has a proof, an acceptance line with that criterion's text and proof, so the goal judges the criterion on the task's line of the same text.

Subtasks that a task is split into, and best-of-n candidates, keep its `goalId`, its goal criteria and a share of its limits, and the goal's limits count every task that carries its id. A task shows its goal ("Part of G-0001, covers criterion 2", with a link) on its card and in its header. The sign-off after a merge links back to the goal and points at the goal's next open task.

### Running it

"Run the goal's tasks" on the goal's page, `stint goal run`, or `POST /api/goals/:id/run` puts every open task on autopilot in the goal's order; a task waits until the tasks it depends on are merged. Before you press the button, the page says what it starts and the goal's limits; in a replay the button is off. Raising a goal limit puts the tasks that autopilot stopped at that limit back on autopilot ([`factory.md`](factory.md#a-goals-limits)).

### How it went

A goal's outcome rolls up from each task's outcome record (`goalOutcome` in `packages/core/src/project/goalOutcome.ts`). Each goal criterion takes the weakest state among the criteria of the tasks that cover it. From weakest to strongest: failing, not checked, you check it, passing, checked by you, proven. A criterion is met when it is proven or checked by you, and a criterion no task covers is not checked. The rollup also gives each task's result, spend and builds against the goal's limits, and how many tasks are merged. A goal is done when every task is merged (a reverted merge does not count) and every criterion is met.

### Commands and routes

| Command | What it does |
|---|---|
| `stint goal new "<title>" --outcome "<what is true>" --criterion "<check>" --criterion "<check>"` | Makes a goal; `--non-goal` adds what it leaves out, `--max-usd` and `--max-builds` set its limits |
| `stint goal sharpen G-0001` | Sharpens it like `stint sharpen`, with `--recommended` and `--json` |
| `stint answer G-0001 Q1 A` | Answers one of its questions |
| `stint goal plan G-0001` | Shows the proposed tasks and asks before creating them; `--yes` creates them without asking |
| `stint goal show G-0001` | Prints the rollup the way `stint outcome` prints a task; `--json` for the record |
| `stint goal list` | Lists each goal with its status, criteria met, tasks and spend |
| `stint goal run G-0001` | Puts every open task of the goal on autopilot |
| `stint goal limits G-0001` | Shows what its tasks have spent and built against its limits; `--max-usd`, `--max-builds` or `--none usd` changes them |
| `stint goal abandon G-0001` | Gives up the goal: it is not split or run again, and its tasks stay as they are |
| `stint proofs G-0001` | Shows or sets the proof of each of its criteria, as for a task |

The routes (each POST needs the daemon token): `POST /api/goals` and `GET /api/goals`; `GET /api/goals/:id` (the goal, its rollup, its sharpen state and any proposal not yet made into tasks); the same sharpen routes as a task, under `/api/goals/:id`, with `POST /api/goals/:id/proofs`; `POST /api/goals/:id/plan` (the proposal) and `POST /api/goals/:id/tasks` (`{ tasks }`, as proposed or edited); `POST /api/goals/:id/abandon`; `POST /api/goals/:id/run`; and `PATCH /api/goals/:id/limits`.

In the web UI, "New goal" (on the Goals page and in the command palette) opens the spec builder set to a goal, and its Write it yourself opens the New goal form. Before anything is sent, that form says in words when a goal has more than 12 criteria or more than 8 non-goals.
