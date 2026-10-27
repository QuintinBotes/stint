# The packet benchmark

`stint bench` measures the packet idea. It runs the same small tasks twice from the same base commit. Each time, the first agent is capped at the same step, and a second agent continues the work. In transcript mode the second agent starts from the first run rendered as text: its messages, its tool calls with their arguments, and its tool results. In packet mode the second agent starts from the packet the capped run built, plus the diff. The bench records what the continued run cost and whether the tests passed when the daemon ran them itself. That is the build leg, the default. `--legs plan,build,review,learn` also measures the other legs through the daemon's own calls: plan through its planner, review through its reviewer on the built branch, and learn by approving, which is the call that starts the daemon's learn step. Review and learn stand on a build, so the build still runs for them; its row is kept only when `build` is listed.

## How to run it

Live, with models (this spends money; the keys for the agents you name must be in the environment):

```
stint bench --tasks 5 --modes transcript,packet
```

The defaults are: implementer `muse-code`, continuer `stint-agent`, one repeat, two bench runs at a time, the build leg, and packets with the diff digest. Flags: `--implementer`, `--continuer`, `--repeat N`, `--concurrency N`, `--legs <list>`, `--host <id>` (run the continuing, plan and review calls on that host's model from the agent chain), `--no-digest` (packets without the diff digest `stint up` adds), `--out <dir>` (default `bench/` in the repository), and `--json` to print the results object instead of the summary. Each host's calls wait on a token bucket filled from its `rpm` and `tpm` in the config, so concurrent runs queue for a rate limit rather than fail on it. The command exits 0 when every run completed, even when some verifications are red, and 1 when a run failed to start.

From the recorded runs, with no model call and no keys:

```
stint bench --replay --tasks 2 --modes transcript,packet
stint bench --replay --from packages/cli/test/fixtures/bench-runs --tasks 2 --modes transcript,packet --json
```

`--from <dir>` names the runs directory (default `bench/runs`); `--host` and `--legs` filter the recorded rows the same way. Replay recounts the prompt tokens from each recorded `prompt.md`, so the numbers come from the artefacts. Replay results carry `replay: true`. The recorded set under `packages/cli/test/fixtures/bench-runs/` was made with fake adapters so CI can run the command without keys; its rows carry `synthetic: true`, and so do results rebuilt from it. Live artefacts under `bench/runs/` come from a live run.

The tasks are in `bench/tasks.json`: five small tasks on the demo webhook service. Each one names a title, a goal, acceptance criteria, the test command, and `killAfterSteps`, the step cap for the first run. The cap sits at about half the steps the task needs, so the continuer always has real work left.

## What a run writes

Each live bench run works in a fresh copy of the fixture repository and keeps its artefacts in `bench/runs/<task>-<mode>/`:

- `transcript.jsonl`: the first run's recorded transcript lines, as the daemon kept them.
- `handoff.json`: the packet the capped first run built. Packet mode continues from this.
- `prompt.md`: the exact prompt the continuer started from.
- `row.json`: the result row for this continued run, plus the facts a replay needs (the base commit, the two adapters and models, and the run's start and end times). The other legs write `row-plan.json`, `row-review.json` and `row-learn.json` beside it, with `plan.json` and `review.json`.

The summary files land in `bench/`:

- `results.json`: the `stint.bench/1` results object described below.
- `results.svg` (dark) and `results-light.svg` (light): grouped bars of continued run input tokens per task by mode, with the pass rate per mode as a label. The daemon also serves `results.json` at `GET /api/bench`.

The renderer that turns transcript lines into the transcript mode prompt lives in `packages/cli/src/bench/transcript.ts` (`bench/transcript.ts` re-exports it). It keeps everything in order and caps only a single tool result at 4 KB.

## What each field means

The top level of `results.json`:

- `version`: always `stint.bench/1`.
- `replay`: true when the results were rebuilt from recorded runs, false for a live run.
- `synthetic`: present and true when any row came from fake adapters rather than a model.
- `commit`: the base commit every task started from.
- `startedAt` and `finishedAt`: when the bench ran (for a replay, the span of the recorded runs).
- `implementer` and `continuer`: the adapters that ran the capped first run and the continued run.
- `models`: the model each adapter ran, by adapter id.
- `rows`: one row per continued run (see below).
- `byMode`: for the build leg, per mode, `runs` (how many continued runs), `meanInputTokens`, `meanPromptTokens`, `meanUsd` (null when a run could not be priced), and `passRate` (the share of continued runs the daemon verified green, from 0 to 1).
- `byLeg`: each leg that ran, summed the same way; a leg passes when it did its work (for build, a green verification).
- `ratio`: the transcript mode mean input tokens over the packet mode mean. Bigger means the transcript cost more input than the packet. Read it next to the pass rates, never alone: a cheap continuation that fails is not a saving.

A build row is the continued run, not the capped first run; a plan, review or learn row is that call:

- `task`: the bench task id from `bench/tasks.json`.
- `leg`: `plan`, `build`, `review` or `learn`; rows recorded before legs existed read as `build`.
- `mode`: `transcript` or `packet`.
- `host` and `model`: who answered the continued run.
- `inputTokens`, `cachedTokens`, `outputTokens`, `usd`: the continued run's usage and cost, as the daemon metered and priced them.
- `wallMs`: the continued run's wall time in milliseconds.
- `verified`: true when the daemon's own run of the task's test command was green after the continued run.
- `promptTokens`: the token count of the prompt the continuer started from, counted with Stint's token counter. This is the direct size comparison between the transcript and the packet.
- `result`: what the leg did, in a few words: the plan's step count, the review verdict, the proposed skill, or whether the daemon verified the build.
- `repeat`: which repeat this row is, starting at 1.

The one-screen summary prints, per mode, the mean input tokens, mean prompt tokens, mean USD and pass rate, then the ratio. When packet mode passes less often than transcript mode, the summary says so and names `leftOut` and `askOfNext` as the fields to improve, because those are the packet fields that carry what the first agent skipped and what it asks the next agent to do.

## Golden tasks

`bench/golden/*.json` holds tasks that must keep passing, run by `stint eval --golden --k 3` (each task k times on fresh fixtures, graded by the daemon's verification plus any scenarios in the file). Results land in `bench/golden-results.json` as `stint.golden/1` with pass@1 (the share of tries that pass), pass^k (the share of tasks where every try passes) and the total cost; recorded runs stay in `bench/golden-runs/` so `--replay` rebuilds the same numbers with no model call. `stint eval add-golden <task>` adds a rejected or reverted task to the set. See `docs/evals.md`.
