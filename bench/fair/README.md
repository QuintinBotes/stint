# The fair hand-off bench

This folder reruns the packet benchmark so the arms differ only in what the next agent is handed, and adds the cheap alternative a packet has to beat. It is for anyone checking the hand-off claim.

## Why it was rerun

The 27 October bench (`bench/results.json`, `bench/runs/`) gave each arm its own first run (`runUnit` in `packages/cli/src/bench/live.ts` at commit `280267f`, line 174), so the arms continued from different points: on `bench-03-delete-tenant` the transcript arm's first run had finished green and the packet arm's had stopped red (`bench/runs/bench-03-delete-tenant-*/handoff.json`). It also had no arm for the task and the diff alone. The 27 October files are kept as they ran.

## What was run

On 2 November 2026, from 18:53 to 19:22 UTC, `scripts/fair-bench.ts` ran the five tasks in `bench/tasks.json`, unchanged, on the demo fixture at `be1bee8`:

- **One first run per task.** Muse Code on Muse Spark 1.3, capped at the task's step (6 to 8 steps), its packet built as `stint up` builds it. These are fresh runs: the 27 October folders keep each first run's packet and transcript but not its change, since the fixture folder is deleted after the run, so the bench cannot restore them without writing a run into `.stint/` by hand.
- **Three arms from that one start, twice each.** The first run's folder is copied once per continued run. Each copy continues with the Stint agent on `meta-api/muse-spark-1.3` (pinned with `--host meta-api`; no fallback happened), with the same budget, the same 40-turn cap and the same prompt frame (rules, goal, acceptance, the fixture's mounted skill, the list of changed files, the ask). Only one section differs:
  - `packet`: the packet the first run built;
  - `transcript`: the first run's transcript, rendered by `packages/cli/src/bench/transcript.ts`;
  - `diff`: the first run's unified diff, and nothing else.
- **Graded by held-out tests.** After each continued run the daemon verifies with `bun run test` as always. Then the held-out tests in `scenarios/<task>/`, written for this rerun from each task's goal and acceptance, are stored and the daemon verifies again, in a checkout of the task branch outside every worktree, as the scorecard does. No agent saw them. Before any live run, each held-out file failed on the untouched fixture and passed on a change written by hand.

## Results

Ten continued runs per arm: five tasks, two runs each.

| Arm | Held-out tests passed | Daemon's verdict green | Hand-over, mean prompt tokens | Input tokens, all 10 runs | Cost, 10 runs |
|---|---|---|---|---|---|
| packet | 10 of 10 | 10 of 10 | 864 | 320,731 | $0.4439 |
| transcript | 10 of 10 | 7 of 10 | 5,124 | 492,433 | $0.5216 |
| diff | 10 of 10 | 4 of 10 | 1,375 | 368,625 | $0.4102 |

The daemon's verdict is its verification of the continued run: the repository's tests and the rule on locked test files must both pass. It is `verified` on each row of `results.json` and `passRate` per arm. Verifying again with the held-out tests added gave the same verdict on every row. The held-out tests are graded apart: `scenarios` on each row counts them, `hidden` is green when none failed, and `hiddenPassRate` per arm is the share of runs where none failed.

By task, green verdicts out of 2, with each shared first run graded alone (its diff applied to a fresh clone, no model call):

| Task | The first run | Held-out tests on the first run alone | packet | transcript | diff |
|---|---|---|---|---|---|
| `bench-01-rate-limit` | capped, 2 of its tests failing | 1 of 3 | 2 | 2 | 2 |
| `bench-02-get-event` | completed, green | 4 of 4 | 2 | 2 | 2 |
| `bench-03-delete-tenant` | capped, a locked test changed without a decision | 5 of 5 | 2 | 0 | 0 |
| `bench-04-audit-limit-config` | capped, two locked tests changed without a decision | 4 of 4 | 2 | 2 | 0 |
| `bench-05-audit-json` | capped, a locked test changed without a decision | 4 of 4 | 2 | 1 | 0 |

All nine red verdicts have no failing test. Each is the locked-test rule: the first run had changed a test file the task names without the `decision: tests:` line the daemon asks for, and the continued run did not add one. Every arm's prompt states that rule; only the packet says this change breaks it, through the daemon's red verification and its ask of next.

The rerun cost $1.8373 by Stint's own records (`spend.json`): $0.4616 for the five first runs and $1.3757 for the 30 continued runs. `priorUsd` in `spend.json`, 1.5, is the `--prior-usd` the script was started with: spend from before this run that counted against the $8 budget, not part of the $1.8373. The daemon's question to Muse Code for its own account of each first run failed with an API 400, so no packet carried that account: each first run's `handoff.created` has an empty `enriched` list, and the log meters the question at 0 tokens, so it adds nothing to the cost.

## What it shows

From one shared start, every arm's code passed every held-out test, 30 of 30: on behaviour the packet, the transcript and the plain diff tied. They split on the daemon's gate. The packet arm went green 10 of 10, because the packet carries what the daemon found and the next agent acted on it; from the transcript the next agent fixed the locked-test problem in 3 of the 6 runs that needed it, and from the diff in none of the 6. The packet was the smallest hand-over, 864 tokens against 1,375 for the diff and 5,124 for the transcript, and the packet arm read 35% fewer input tokens than the transcript arm over the whole run.

## What it does not show

That a packet makes the next agent write better code. Four of the five first runs already passed their held-out tests before anyone continued them, so on those tasks the continuer had only the locked-test bookkeeping left. Only `bench-01-rate-limit` left code to write, and all six continued runs wrote it. The step caps in `bench/tasks.json` were set at about half of what each task needed; on 2 November Muse Code got nearly all of the way in that many steps.

It does not reproduce the 27 October behaviour gap either, and the diff arm, not the packet, was the cheapest at $0.4102. Ten runs per arm on five small tasks, one fixture and one continuing model is a measurement, not a law; the locked-test effect rests on three tasks.

## Files

- `results.json`: the `stint.bench/1` results, read the same way as `bench/results.json` (see `bench/README.md`), with `hidden` and `scenarios` on every row.
- `results.svg` and `results-light.svg`: input tokens per continued run by task and arm, each arm labelled with the share of its runs that passed every held-out test.
- `spend.json`: the spend by task, from every `run.finished` and `cost.recorded` in the run logs, the shared first run counted once.
- `runs/<task>-<arm>-r<n>/`: `handoff.json` and `transcript.jsonl` (the shared first run's packet and transcript), `prompt.md` (what the continuer was handed), `row.json`, `events.jsonl` (the task's whole timeline in that copy), `handoff-continued.json` (the packet the continued run built) and `diff.patch` (the change after it).
- `scenarios/<task>/test/*.test.ts.txt`: the held-out tests. The `.txt` keeps them out of this repository's own test run.

The published files went through the scorecard's scrub (local paths, the home folder, the user name, key values, emails and dashes), and each event log's hash chain and each packet's hash were computed again over the scrubbed text.

## Run it again

`STINT_LIVE=1 bun --env-file=<your env file> scripts/fair-bench.ts --budget-usd 8 --repeat 2` runs one task at a time and starts a task only when the spend so far plus the largest a task can be expected to cost fits the budget. `bun scripts/fair-bench.ts --account-only` rebuilds `spend.json`, `results.json` and the charts from `runs/` with no model call. To grade a first run alone, apply the diff in any `runs/<task>-diff-r1/prompt.md` to a clone of `demo/repo.bundle`, copy the task's held-out file in without `.txt`, and run `bun run test` on it.
