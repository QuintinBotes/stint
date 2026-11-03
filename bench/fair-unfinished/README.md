# The unfinished hand-off bench

This folder runs the fair hand-off bench (`bench/fair/`) again from first runs that stop well before the work is done, and adds a fourth arm: the first agent resuming its own session. It asks whether a packet helps the next agent finish work that is genuinely unfinished, compared with the transcript, the task and the diff, and the agent picking up where it left off. It is for anyone checking the hand-off claim.

## Why it was run

In the fair rerun, four of the five first runs already passed their held-out tests before anyone continued them (`bench/fair/README.md`). Muse Code got nearly all of the way in the step cap, so the continuer mostly had bookkeeping left. That rerun shows the packet carries what the daemon found, not that the next agent finishes code better.

## What was run

On 2 November 2026, `scripts/unfinished-bench.ts` ran on the demo fixture at `be1bee8`, with the tasks in `bench/tasks.json` and only the step cap changed.

- **Checkpoints, 20:27 to 20:41 UTC.** One Muse Code first run per task on Muse Spark 1.3, its packet built as `stint up` builds it. Each cap was set by trying it: a checkpoint counts only if its diff, applied to a fresh clone with no model call, fails the task's held-out tests. Six first runs were made, every one of them below.
- **Continued runs, 20:43 to 21:00 UTC.** Each continued run starts from its own copy of the task's one checkpoint. Four arms, two runs each:
  - `packet`, `transcript` and `diff`: the Stint agent on `meta-api/muse-spark-1.3` (pinned with `--host meta-api`; no fallback happened), with the 40-turn cap and the prompt frame of the fair rerun. Only the hand-over section differs: the packet, the rendered transcript, or the first run's diff.
  - `resume`: Muse Code on Muse Spark 1.3 resumes its own session with `muse exec --session-id <id> --allow-workspace-switch`, capped at 40 model steps. It is told only this, and keeps everything its session holds: "You were stopped by the step cap before the task was done. Continue it from where you stopped: finish the goal and every acceptance criterion, and make the test command pass. Your earlier changes are in the current directory." The bench copies the session the moment the first run ends, before the daemon asks it for the packet, and puts that copy back before each resumed run, so both resumed runs start from the same history.
- **Graded by the fair rerun's held-out tests** (`bench/fair/scenarios/`), stored after each run, as in the fair rerun. No agent saw them.

The resume arm differs from the others in harness as well as input. Muse Code, not the Stint agent, does the work. It runs on Muse Code's own sign-in, not the Meta Model API key. It re-reads its whole session on every step (36,887 and 34,207 tokens on the first model call of the second resumed run of each task). And it works in a new folder, so Muse Code has to be told the workspace moved.

## The checkpoints

| Task | Cap (fair rerun) | What the first run changed | Its own tests | Held-out tests on the checkpoint | Continued |
|---|---|---|---|---|---|
| `bench-01-rate-limit` | 5 (8) | `src/config.ts`, `src/lib/limiter.ts` | 2 failed of 27 | 1 of 3 | yes |
| `bench-02-get-event` | 4 (6) | `src/routes/events.ts`, `test/events.test.ts` | 30 passed | 4 of 4, finished | no |
| `bench-02-get-event` | 3 | `src/routes/events.ts` | 27 passed | 4 of 4, finished | no |
| `bench-03-delete-tenant` | 5 (7) | `src/lib/tenants.ts` | 27 passed | 2 of 5 | yes |
| `bench-04-audit-limit-config` | 5 (8) | `src/config.ts` | 27 passed | 0 of 4 | no, the budget stopped it |
| `bench-05-audit-json` | 6 (7) | `src/lib/audit.ts` | 27 passed | 2 of 4 | no, the budget stopped it |

`bench-02-get-event` is dropped: at caps of 4 and 3 the first run finished the task. A cap of 2 was not tried, because before writing code Muse Code spent its first steps reading files, so such a checkpoint would hold no code. The bench runs one task at a time and starts a task only when the spend so far plus a quarter more than the dearest task so far fits the $4 budget. It stopped before `bench-04-audit-limit-config` ($2.4059 spent plus up to $1.6145). That leaves two tasks, `bench-01-rate-limit` and `bench-03-delete-tenant`, with two runs per arm.

## Results

Four continued runs per arm: two tasks, two runs each.

| Arm | Held-out tests passed | Daemon's verdict green | `tests:` line written by the continuer | Hand-over, mean prompt tokens | Input tokens, 4 runs (cached) | Cost, 4 runs | Mean wall time |
|---|---|---|---|---|---|---|---|
| packet | 4 of 4 | 3 of 4 | 3 of 4 | 813 | 509,009 (234,559) | $0.6750 | 69 s |
| transcript | 4 of 4 | 3 of 4 | 3 of 4 | 4,823 | 363,377 (173,991) | $0.4225 | 40 s |
| diff | 4 of 4 | 4 of 4 | 4 of 4 | 869 | 330,399 (145,666) | $0.4485 | 47 s |
| resume | 4 of 4 | 4 of 4 | 4 of 4 | 63, plus its own session | 1,209,814 (1,062,492) | $0.4011 | 41 s |

By task, green verdicts out of 2:

| Task | packet | transcript | diff | resume |
|---|---|---|---|---|
| `bench-01-rate-limit` | 2 | 2 | 2 | 2 |
| `bench-03-delete-tenant` | 1 | 1 | 2 | 2 |

The two red verdicts have no failing test. On `bench-03-delete-tenant` all eight continued runs changed the locked `test/admin.test.ts`, as the task asks. Six wrote the `decision: tests:` line and went green. Two did not, the first packet run and the first transcript run, and went red. The checkpoint had not touched that file, so no hand-over could warn about it. Every arm's prompt, the resumed session's first prompt included, states the rule.

The experiment cost $2.4059 (`spend.json`). By Stint's own records, $0.4151 went to the six first runs and $1.9471 to the 16 continued runs: $1.2916 on `bench-01-rate-limit`, $0.6555 on `bench-03-delete-tenant`. The other $0.0437 is a single one-step probe of a fair-rerun session, run before the bench to check that `muse exec --session-id` resumes a capped session. It was priced from Muse Code's own usage at Stint's Muse Spark 1.3 rate.

## What it shows

From checkpoints that failed their held-out tests, every arm finished the code: 16 of 16 continued runs passed every held-out test. On this sample, the packet did not help the next agent finish unfinished work more often than the transcript, the diff or its own session did. It was also the dearest arm, $0.6750 against $0.40 to $0.45 for the others, and the slowest, mostly on `bench-01-rate-limit`, where the two packet runs cost $0.2820 and $0.2318. The packet was the smallest hand-over to a different agent, 813 tokens against 869 for the diff and 4,823 for the transcript. Resuming the agent's own session was the cheapest arm, because 88% of its input was cached, though it read the most tokens.

## What it does not show

That any arm is better at finishing code. All four tied on the held-out tests, and four runs per arm on two small tasks, one fixture and one continuing model is too few to separate them. The red verdicts are two runs that skipped one line of bookkeeping, not worse code. The fair rerun's locked-test effect does not arise here, because these checkpoints did not change a locked test.

It also does not test a packet at its best. In every live first run, here and in the fair rerun, the daemon's question to Muse Code failed with an API 400, so no packet carried Muse Code's own account of where it stopped. Where the session log still holds the question, Muse Code records "reasoning `encrypted_content` was not issued to this caller". The run used Muse Code's own sign-in, and the question went out with the API key from the environment. Each packet was built from events alone. The packet built that way can also understate what is left. The `bench-03-delete-tenant` checkpoint passed its own 27 tests, so its packet reported a green verification and asked the next agent to review the change, not to finish it. The continuers finished it anyway.

## Files

- `results.json`: the `stint.bench/1` results, read as `bench/fair/results.json` is, with `mode: "resume"` for the fourth arm, and `hidden`, `scenarios` and `testsDecision` on every row.
- `checkpoints.json`: every first run tried, with its cap, cost, changed files, its own test line, the held-out line and whether it was continued.
- `spend.json`: the spend by Stint's records, the probe as `priorUsd`, and where the budget stopped the run.
- `results.svg` and `results-light.svg`: input tokens per continued run by task and arm, each arm labelled with the share of its runs that passed every held-out test.
- `runs/<task>-<arm>-r<n>/`: the files below. The resume arm's continued transcript lives in Muse Code's own session store and is not published.
  - `handoff.json` and `transcript.jsonl`: the shared first run's packet and transcript.
  - `prompt.md`: what the continuer was handed; for resume, the instruction alone.
  - `row.json`.
  - `events.jsonl`: the task's whole timeline in that copy.
  - `handoff-continued.json`: the packet the continued run built.
  - `diff.patch`: the change after the continued run.

The published files went through the scrub that `bench/fair` uses, which takes out local paths, the home folder, the user name, key values, emails and dashes. After the scrub, each event log's hash chain and each packet's hash were computed again over the scrubbed text.

## Run it again

`STINT_LIVE=1 bun --env-file=<your env file> scripts/unfinished-bench.ts checkpoint --task <id> --cap <n> --budget-usd 4` makes one capped first run, keeps it outside the repository (`--state`, a temporary folder by default) and grades it with no model call. `... continue --budget-usd 4` continues every arm twice from each task's last unfinished checkpoint, one task at a time, and skips a task already continued. `bun scripts/unfinished-bench.ts account` rebuilds `checkpoints.json`, `spend.json`, `results.json` and the charts from `runs/` and the state folder, with no model call. The resume arm needs Muse Code signed in, and it reads and restores the session folders under `~/.local/share/muse/sessions/`.
