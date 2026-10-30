# R-073 · The terminal tells the whole story: follow, stop and review a task

Day: 5 (30 Oct) · Owner: CC · Depends on: R-012, R-016, R-066 · Fallback: the web UI stays the only place to watch a run, stop it, or ask for a review · Cut order: 3

## Goal
The owner asked on 30 Oct for the demo to run mostly in a terminal, with the UI only where it adds something. The CLI could start a run and hand it on, but it could not show what the run was doing, stop it, or ask for a review, so a terminal user went to the browser for the three moments the product is about. This spec adds them, so one task can go from a sentence to a merge without leaving the terminal: draft it, build it, watch it, stop it, hand it on, review it offline, approve it.

## Requirements
1. `stint watch <task>` MUST follow the task live over `GET /api/tasks/:id/stream`, one line per event that says what happened: time (local), run, and the words. It MUST show runs starting and ending (with who did the work and, for a plan or review call, the model that answered and whether it ran on this machine), file edits with their size, decisions, packets with their size (who a handed packet is for, and that a killed run's packet was built from the log and the diff), Stint's test runs, reviews, refused runs, approval and the merge. It MUST leave out tool results, costs and status flips. `--all` prints what already happened first. Colour only on a terminal with `NO_COLOR` unset, and every pass or fail line carries ✓ or ✗ so no meaning rests on colour.
2. `stint stop <task> [--run rN]` MUST stop the run that is going, as Stop the run does in the UI, and say where its packet is; with no run going it MUST exit 1 saying so. The command palette's Stop the live run names it as its CLI equivalent.
3. `stint review <task> [--host <host>]` MUST review the verified change now, on the reviewer chain or on one host, and print who reviewed it, where, its cost, the verdict and each finding; `--host ollama` reviews on this machine with no network.
4. `stint up --no-review` MUST leave a person's finished build unreviewed until `stint review`; without the flag nothing changes (D-080).
5. `stint draft --task` MUST keep the draft one task where the model might have made it a goal, as the task/goal switch in the spec builder does.
6. Model display names live once, in core (`modelName`), for the UI and the CLI.
7. A harness drives the same story over MCP: `stint_new_goal` makes a goal, `stint_plan_goal` has the planner split it into tasks that wait on each other and creates them, `stint_run_goal` puts its open tasks on autopilot, and `stint_stop` stops a live run so its packet can be handed on. None of them approves or merges, and none is listed inside a run.

## Acceptance
1. `packages/cli/test/watch.test.ts`: the feed's lines for the event shapes of the 30 October live take, exact; `stint stop` stops a sleeping fake run (exit 0, the run ends killed) and exits 1 with no run going; `stint watch` follows a real daemon and prints the run, its edit, its packet and Stint's test run.
2. `packages/cli/test/review.test.ts`: `stint review --host ollama` against a fake local model prints the reviewer on this machine, $0.00, the verdict and the summary.
3. `packages/cli/test/draft.test.ts`: `stint draft --task` on words the model would make a goal prints a task.
4. `packages/cli/test/mcp.test.ts`: from an MCP client, a goal is made, split into two tasks where the second waits on the first, run, and its live run stopped and ended killed; the in-run tool list is unchanged.
5. The README's command table names `watch`, `stop` and `review` and `stint up --no-review`; `bash scripts/check.sh` and `bun run test:ui` pass.
