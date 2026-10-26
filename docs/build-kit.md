# Stint build kit

Everything an agent needs to build Stint for the Meta Global AI Developer Hackathon, in a loop, until the goal is met. Copy this folder's contents into the repo root on 26 October (R-001 does it), then run the loop.

```
AGENTS.md        the brief every agent reads first: what Stint is, the demo, 12 non-negotiables, layout, formats, pins, how to work
GOAL.md          the goal and the 13-line definition of done, the four gates, the cut order, the budget guard
LOOP.md          one build iteration: orient, pick the first eligible spec, tests first, verify, record, commit, stop
REVIEW.md        one review iteration by a different model: run Verify, check acceptance, interfaces, non-negotiables, scope, honesty
PROGRESS.md      the ledger: specs with status, gates, decisions, deviations, reviews, blocked questions, spend
specs/           SPEC-000 (how specs work), F-001 (the demo fixture), R-001 … R-024 (the build, one spec per task)
schemas/         the contracts: handoff, task, event, plan, review, skill frontmatter, skill proposal (JSON Schema 2020-12)
design/          tokens.json and tokens.css from the Stint design system (dark default) for R-007
scripts/loop.sh  runs the loop: Muse Code builds on one Meta model, reviews on another, models swap on a double handoff, stops for humans
scripts/gate.sh  the checks for gates 1 to 4
```

## Run it

```bash
# once, on the demo laptop
export META_API_KEY=…          # Muse Code and the Model API
export BASETEN_API_KEY=…       # Muse Spark Open hosted, 2M TPM: planner fallback, learn step, the bench
export FIREWORKS_API_KEY=…     # Muse Spark Open hosted with enforced json_schema and cached input
ollama pull muse-glimmer:30b-mlx

# the loop: Muse Code builds on BUILD_MODEL and reviews on REVIEW_MODEL
scripts/loop.sh

# one iteration only, to watch it work
scripts/loop.sh --once

# Stint builds itself: the next spec becomes a Stint task on autopilot, and the loop stops at your approval
stint up            # in another terminal
scripts/loop.sh --self
```

In self mode the loop runs `stint new --spec specs/R-0NN-*.md`, which makes a task from the spec's goal, acceptance lines and Verify command. It then runs `stint run <task> --wait`. Autopilot plans, builds, verifies and reviews the task on Meta's models in its own worktree, and the loop stops at the approval gate. It never approves: you read the change with `stint show`, then `stint approve` or `stint reject`.

`stint report` prints the Reviews and Spend tables from the workspace's own events. `stint report --write` puts the rows for spec tasks into `PROGRESS.md` and leaves the loop's own rows alone, so the repository's `.stint/` history is the record of how Stint was built.

The loop stops and tells you why when: a spec writes a question under Blocked; every spec before a gate is done (run `scripts/gate.sh n`, then write `GATE n: PASS` in PROGRESS.md); `MAX_ITER` (40) or `MAX_USD` (25, approximate) is reached; or everything is done. Restart it after you answer.

## How the loop thinks

1. Every iteration is a fresh session with no memory. `LOOP.md` tells it to read `AGENTS.md`, `GOAL.md`, `PROGRESS.md` and the spec conventions, then take the **first** eligible row: `handed` first (someone stopped mid-spec), then `in_progress` (a crashed session), then `todo`, and only when its dependencies are `done`.
2. It writes the tests from the spec's Acceptance lines first, implements the Requirements, runs the spec's Verify block, then typecheck and the full suite. Green: `done`, one Notes line that says what was left out, a commit with `Spec:` and `Model:` trailers. Not green: a handoff note in packet shape (done, open, leftOut, risks, decisions, askOfNext) and the row set to `handed`.
3. After a `done`, a different model reviews with `REVIEW.md`: it re-runs Verify, checks every acceptance line has a test, the interfaces match byte for byte, the non-negotiables hold, nothing was left out that the Notes do not say. `approve` keeps `done`; `request_changes` sets `handed` with the findings as the next ask; `block` stops for you.
4. A spec handed off twice on one model goes to the other, the way Stint hands a task between agents. Three attempts without green: `blocked`, your call.
5. Decisions, deviations and questions are rows in `PROGRESS.md`, never memory. Cuts are yours: write `cut` in the Status column.

## What to do before 26 October

Build F-001 (the demo fixture, allowed pre-event), apply by 25 October, create the npm org (`stint-dev`), claim the hackathon partner credits (Baseten $100 and 2M TPM, Fireworks $25, Modal $100) and make the two API keys, install Muse Code and run `muse exec --json` and `muse schema` once on a toy repo, pull Glimmer and time a 3k-token review, and read the Official Rules on 26 October before `LICENSE` is added. The research doc has the compliance checklist.

## Models and roles in the build itself

| Role in the loop | Default | Why |
|---|---|---|
| Builder | Muse Code (`muse exec --json`, spark-1.3) | the hero of the hackathon builds its own product; its event stream is the fixture for R-009 |
| Reviewer | Muse Code on a different Meta model (`REVIEW_MODEL`) | a different model grades the work, like the product's generator-is-not-the-judge rule |
| Continue on double handoff | the other model | proves the handoff note works across agents before the product does |
| Local review | Glimmer via Ollama | optional: set `--reviewer none` and run `stint review` once R-010 exists |

Flags used: `muse exec --json --prompt-file --model --max-model-steps --trust-workspace`, with Muse's own approval policy and sandbox left on.
