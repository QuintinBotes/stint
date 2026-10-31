# Stint build kit

This page describes the spec-driven build kit Stint was built with: what is in it, how to run the loop, and how the loop decides what to do next.

The kit was written before the event, and R-001 copied it into the repository root on 26 October. The specs after R-024, and R-013 as it now reads, were written during the event ([`timeline.md`](timeline.md)).

```text
AGENTS.md        the brief every agent reads first: what Stint is, the demo, 12 non-negotiables, layout, formats, pins, how to work
GOAL.md          the goal and the 13-line definition of done, the four gates, the cut order, the budget guard
LOOP.md          one build iteration: orient, pick the first eligible spec, tests first, verify, record, commit, stop
REVIEW.md        one review iteration by a different model: run Verify, check acceptance, interfaces, non-negotiables, scope, honesty
PROGRESS.md      the ledger: specs with status, gates, decisions, deviations, reviews, blocked questions, spend
specs/           SPEC-000 (how specs work), F-001 (the demo fixture), R-001 to R-074 (the build, one spec per task; R-028, R-071 and R-072 have rows in PROGRESS.md but no spec file)
schemas/         the contracts: handoff, task, event, plan, review, skill, skill proposal, metrics, outcome, questions, goal, draft, scorecard (JSON Schema 2020-12)
design/          tokens.json and tokens.css from the Stint design system (dark default) for R-007
scripts/loop.sh  runs the loop: Muse Code builds on one Meta model, reviews on another, models swap on a double hand-off, stops for humans
scripts/gate.sh  the checks for gates 1 to 4
```

## Run it

```bash
# once, on the build machine
export META_API_KEY=…          # Muse Code and the Meta Model API (a stored muse login also works for Muse Code)
export BASETEN_API_KEY=…       # Muse Spark Open hosted, 2M TPM: planner fallback, learn step, the bench
export FIREWORKS_API_KEY=…     # Muse Spark Open hosted with enforced json_schema and cached input
ollama pull muse-glimmer:30b-mlx

# the loop: Muse Code builds on BUILD_MODEL (muse-wonder-full-1.0) and reviews on REVIEW_MODEL (muse-spark-1.3)
scripts/loop.sh

# one iteration only, to watch it work
scripts/loop.sh --once

# Stint builds itself: the next spec becomes a Stint task on autopilot, and the loop stops at your approval
stint up            # in another terminal
scripts/loop.sh --self
```

In self mode, the loop runs `stint new --spec specs/R-0NN-*.md`, which makes a task from the spec's goal, acceptance lines and Verify command, then runs `stint run <task> --wait`. Autopilot plans, builds, verifies and reviews the task on Meta's models in its own worktree, and the loop stops at the approval gate. It never approves: you read the change in the task view, then run `stint approve` or `stint reject`.

`stint report` prints the Reviews and Spend tables and a metrics block from the workspace's own events. `stint report --write` puts the rows for spec tasks into `PROGRESS.md` and leaves the loop's own rows alone, so the repository's `.stint/` history is the record of how Stint was built.

The loop stops and says why when:

- a spec writes a question under Blocked;
- every spec before a gate is done (run `scripts/gate.sh n`, then write `GATE n: PASS` in `PROGRESS.md`);
- `MAX_ITER` (40) or `MAX_USD` (25, approximate) is reached;
- everything is done.

Restart it after you answer.

## How the loop thinks

1. Every iteration is a fresh session with no memory. `LOOP.md` tells it to read `AGENTS.md`, `GOAL.md`, `PROGRESS.md` and the spec conventions, then take the **first** eligible row: `handed` first (someone stopped mid-spec), then `in_progress` (a crashed session), then `todo`, and only when its dependencies are `done`.
2. It writes the tests from the spec's Acceptance lines first, implements the Requirements, runs the spec's Verify block, then the typecheck and the full suite.
   - Green: it marks the row `done`, writes one Notes line that says what was left out, and commits with a `Spec:` trailer. `LOOP.md` also asks for a `Model:` trailer; commits until 27 October carry one, and later commits carry only `Spec:` while the spec's row in `PROGRESS.md` names the model.
   - Not green: it writes a hand-off note in packet shape (done, open, leftOut, risks, decisions, askOfNext) and sets the row to `handed`.
3. After a `done`, a different model reviews with `REVIEW.md`. It re-runs Verify and checks that every acceptance line has a test, the interfaces match byte for byte, the non-negotiables hold, and nothing was left out that the Notes do not mention. `approve` keeps `done`, `request_changes` sets `handed` with the findings as the next ask, and `block` stops for you.
4. A spec handed off twice on one model goes to the other model, the way Stint hands a task between agents. After three attempts without green, the row is `blocked` and the call is yours.
5. Decisions, deviations and questions are rows in `PROGRESS.md`, never memory. Cuts are yours: write `cut` in the Status column.

## Before the event

The kit's checklist for the days before 26 October:

- build F-001, the demo fixture (allowed before the event);
- apply by 25 October;
- create the npm org (`stint-dev`);
- claim the hackathon partner credits (Baseten $100 and 2M TPM, Fireworks $25, Modal $100) and make the two API keys;
- install Muse Code and run `muse exec --json` and `muse schema` once on a toy repository;
- pull Muse Glimmer and time a 3k-token review;
- read the Official Rules on 26 October before adding `LICENSE`.

## Models and roles in the build

| Role in the loop | Default | Why |
|---|---|---|
| Builder | Muse Code (`muse exec --json`) on `BUILD_MODEL`, `muse-wonder-full-1.0` | Muse Code builds the product that drives it, and its event stream is the fixture for R-009 |
| Reviewer | Muse Code on `REVIEW_MODEL`, `muse-spark-1.3` | A different model grades the work, matching the product's rule that the generator is not the judge |
| Continue on double hand-off | The other model | Proves the hand-off note works across agents before the product does |
| No review | None | `--reviewer none` skips the review iteration |

The loop calls `muse exec --json --model --prompt-file --trust-workspace --max-model-steps`, with Muse Code's own approval policy and sandbox left on.
