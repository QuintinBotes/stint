# Sharpen a task before it starts

Most agent work that goes wrong starts as an unclear task: nobody said what done looks like, what is out of scope, or how a criterion is proven. Sharpen settles that before an agent spends money on it. Stint asks the few questions whose answers change what gets built or how it is proven, recommends an answer to each, settles the rest itself and says so, and records every answer as a decision that later runs keep.

## How a round works

A round is one call to the sharpen chain: `routes.sharpen` when it is set, else the planner chain (the task's own planner route wins over the config one). The prompt carries the task's title, goal, numbered acceptance criteria, test command and checks; the similar tasks and the decisions and findings on the files it names, from the memory; up to 200 tracked file paths; the task's valid decisions; and every earlier round's questions and answers.

The model answers in `stint.questions/1` ([`schemas/questions.schema.json`](../schemas/questions.schema.json)): questions, assumed items and proof suggestions. The schema is the shape only. Every rule below is checked in code (`questionProblem` in `packages/core/src/sharpen.ts`), so one bad question is dropped and the rest are kept.

A question is kept only if:

- its text ends in "?" and has at least 5 words;
- `changes` is `implementation`, `proof`, `scope` or `authority`;
- `evidence`, what Stint found that raised it, is not empty;
- it has 2 to 4 options with distinct labels, each with a consequence;
- its recommendation is one of the option labels, with a why;
- its safe default, when it names an option, names one of them;
- the criteria it blocks are criteria the task has (they count from 1);
- the repository cannot answer it: no "which file", "what version", "where is", "does the repo" or "what framework";
- it asks for a decision, not permission or an opinion: no "should I proceed", "do you want me to", "any thoughts" or "is that ok".

A dropped question is listed in the round's `dropped` with its reason. A round keeps at most `sharpen.maxQuestions` questions (5 by default), material ones first; any beyond that are dropped with that reason too. Questions are numbered `Q1`, `Q2` and on across rounds, and assumed items `A1`, `A2` and on.

## What is always asked

A question is material when the model says so, or when the code finds:

- no safe default, an answer that is cheap to reverse later;
- `changes` is `scope` or `authority`;
- the text or an option mentions security, auth, permissions, secrets, privacy or personal data, billing, payments, prices, money, deleting or dropping data, migrations, or something irreversible.

The code can only make a question material, never the other way. A material question is always asked and carries "Needs your answer". A question that is not material can be settled with its recommendation: "Use the recommendations for the rest" in the task view, `stint sharpen --recommended`, or autopilot when it sharpens first.

The reversible details Stint settled itself are listed as **Assumed**, each with why. Change one, and your words replace it.

## Answers become decisions

Every answer is a `sharpen.answered` event and a decision in the task's `decisions.md` that pairs the question with the answer, for example "Do retries of a failed webhook count towards the limit? Answer: Retries do not count", with `sharpen:Q2` as its evidence. A recommendation taken without asking says "(the recommendation)" and is recorded by whoever took it: you, or `autopilot`. Answering a question again, or changing an assumption again, supersedes the earlier decision; nothing is edited.

The planner prompt carries these decisions, the assumptions nobody changed, and the accepted proofs, under "Before work started". The first build's ask carries the same lines. A task that was never sharpened gets the same prompts as before.

## Proofs

Each criterion gets one proof, numbered from 1 like the acceptance lines:

| Kind | `ref` names |
|---|---|
| `test` | a test name or part of one; the test should fail before the change and pass after it |
| `scenario` | a held-out scenario |
| `check` | a check, such as `typecheck` |
| `human` | what a person looks at before approving |

A round suggests one proof per criterion. Accepted proofs live in `task.json` as `proofs` and are what the outcome record reads. "Use these proofs" in the task view, or `stint proofs --set`, accepts them and records `proofs.set`.

A task is **ready** when no material question is open and every criterion has an accepted proof.

## Autopilot

With `sharpen.beforeAutopilot` on, autopilot sharpens a task before it plans it. After the round it stops with "Needs you: 2 questions to answer before it starts." while material questions are open. Once you have answered them and switched autopilot on again, it takes the recommendation for the rest, as `autopilot`, and plans. If no model can answer the round, autopilot says so and plans without questions. It is off by default, so the replay and the demo are unchanged.

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

The routes behind them, each POST needing the daemon token: `POST /api/tasks/:id/sharpen` starts a round (409 while a run is live), `GET /api/tasks/:id/sharpen` returns the state, `POST /api/tasks/:id/sharpen/answer` takes `{ question | assumption, option?, text? }` and returns the decision id, `POST /api/tasks/:id/sharpen/recommended` takes the recommendations, and `POST /api/tasks/:id/proofs` takes `{ proofs }`.

## Config

```json
"sharpen": { "beforeAutopilot": false, "maxQuestions": 5 },
"routes": { "sharpen": ["meta-api/muse-wonder-1.0"] }
```

`maxQuestions` is 1 to 10. A round's cost is recorded on `sharpen.asked` and counts in the week under the role "sharpens tasks", like the other model calls that are not runs.
