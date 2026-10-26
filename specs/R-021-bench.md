# R-021 · Bench

Day: 7 (2 Nov) · Owner: MC · Depends on: R-009, R-012, R-013 · Fallback: 3 tasks instead of 5 · Cut order: 1

## Goal
The evidence that the packet idea holds, as a built-in command rather than a slide: run the same N tasks twice from the same base commit, once resuming the second agent from the full first-run transcript and once from `handoff.json` plus the diff, and record input tokens, cost, wall time and whether the daemon's verification passed. The result is unknown until it runs; that honesty is part of the pitch.

## Context
`stint bench --tasks 5 --modes transcript,packet` writes `bench/results.json` and one chart; the chart goes in the README and the video. Five small tasks on the demo repo are enough. If packets lose on pass rate, `leftOut` and `askOfNext` are what to fix, and the benchmark says so.

## Requirements
1. MUST define `bench/tasks.json`: five small tasks on the fixture (each one to two files, a test, under 10 minutes), each with goal, acceptance, `testCommand`, and a `killAfterSteps` number so the first run is capped at the same point in both modes.
2. MUST implement `stint bench --tasks N --modes transcript,packet [--implementer muse-code] [--continuer stint-agent|muse-code] [--repeat 1] [--host baseten|fireworks|meta-api] [--concurrency 2]`: for each task and mode, from the same base commit in a fresh fixture copy: run the implementer capped at `killAfterSteps` (ends `capped`), then continue with the continuer from either (a) the full `transcript.jsonl` rendered as the prompt (mode `transcript`) or (b) `renderHandoff(packet)` plus the diff (mode `packet`); verify; record `{ task, mode, host, model, inputTokens, cachedTokens, outputTokens, usd, wallMs, verified: boolean, promptTokens }`. The plan, review and learn legs of every bench run go to `--host` (default `baseten`: its 2M TPM hackathon limit lets five tasks in two modes finish in minutes), with `--concurrency` runs in parallel bounded by the host's `tpm` and `rpm` in `config.json`; the implement and continue legs stay on Muse Code and the Stint agent because those are the agents under test.
3. MUST write `bench/results.json` (`stint.bench/1`, with the git commit, dates, models and the per-task rows plus totals and means per mode) and `bench/results.svg` (grouped bars: input tokens per continued run by mode, with pass rate as a label), generated without a browser (hand-written SVG from the numbers, dark and light variants).
4. MUST print a one-screen summary: per mode, mean input tokens, mean USD, pass rate, and the ratio; and a sentence when packets lose on pass rate naming the fields to fix.
5. MUST support `--replay` that produces the same artefacts from recorded runs so CI can exercise the command without keys, marked `replay: true` in the results.
6. SHOULD add `GET /api/bench` serving `bench/results.json` for the Factory view.

## Interfaces
- `stint bench … --json` prints the results object; exit 0 when every run completed (regardless of pass rate), 1 when a run failed to start.

## Acceptance
1. `stint bench --replay --tasks 2 --modes transcript,packet` writes `results.json` validating against the shape and an SVG with two groups: `packages/cli/test/bench.replay.test.ts`.
2. The transcript-mode prompt token count is larger than the packet-mode one for the recorded runs, and both are reported: same file.
3. With `STINT_LIVE=1`, three tasks run live end to end and `verified` is reported per row: `packages/cli/test/bench.live.test.ts` (skips otherwise).
4. The Factory view shows the benchmark bars when `results.json` exists: `apps/web/e2e/factory.spec.ts` (extends R-019).

## Verify
```
bun test packages/cli
./packages/cli/bin/stint bench --replay --tasks 2 --modes transcript,packet --json | head -c 400
```

## Out of scope
Statistical rigour beyond means and counts, more than one continuer per run.

## Notes
Keep the transcript rendering faithful (what a naive "resume from the log" tool would do): the agent messages and tool calls in order, truncated only at the model's context limit. The number to quote in the README is the ratio of mean input tokens with the pass rates beside it; never quote the ratio alone.
