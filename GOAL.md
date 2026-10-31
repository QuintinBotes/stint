# GOAL.md: what the loop is driving toward

This file defines "done" for Stint's build loop (`scripts/loop.sh`) and the agents it runs. The loop stops when every line under **Definition of done** is true and checked by a command, not by a claim. Until then, `LOOP.md` picks the next spec in `PROGRESS.md`.

## The goal, in one paragraph

By **3 November 2026, 23:00 CET**, the `stint` repo is public-ready and `stint demo` replays the full 2:35 beat sheet in the UI with no API keys, while `stint demo --live` runs the same script for real on the demo laptop: a task spoken into Stint is planned by Muse Wonder, built by Muse Code in a worktree, killed on camera, continued by the Stint agent on Muse Spark from a sub-600-token packet to a green daemon-run verification, reviewed offline by Muse Glimmer at $0.00 with a contradiction routed to the queue, approved and merged with `Stint-Task` trailers, and followed by a learned skill that the next task runs with. The whole task costs under one dollar at list prices, and the repo's own `.stint/` history shows Stint built itself.

## Definition of done (every line is a check)

| # | Done when | Check |
|---|---|---|
| 1 | CI is green on ubuntu-latest and macos-latest | `gh run list --limit 1 --json conclusion` shows `success` on `main` |
| 2 | The packet schema is published with three validating examples | `bun test packages/core` includes `handoff.schema.test.ts` passing; `packages/core/schemas/examples/*.json` validate |
| 3 | A killed Muse Code run still yields a valid packet under 600 tokens | `bun test packages/daemon/test/handoff.kill.test.ts` passes |
| 4 | The Stint agent continues from a recorded packet and the daemon's verify is green (33 tests in the demo repo) | `bun test packages/daemon/test/continue.live.test.ts` passes with `STINT_LIVE=1` (or the recorded replay variant without it) |
| 5 | An offline Glimmer review validates against `stint.review/1` and a contradiction is routed, not applied | `bun test packages/daemon/test/review.offline.test.ts` passes with Ollama up and network off |
| 6 | Approve merges with `Stint-Task`, `Stint-Runs`, `Stint-Handoff` trailers; reject re-opens at `building` | `bun test packages/daemon/test/approve.test.ts` passes; `git log -1 --format=%B` in the fixture shows the trailers |
| 7 | The learn step proposes a skill from a recurring finding; approving writes `.agents/skills/<id>/SKILL.md`; the next run shows `skill.applied` | `bun test packages/daemon/test/learn.test.ts` passes on the seeded fixture |
| 8 | The memory graph answers `similar`, `files-together`, `constrains` and `?asOf=` hides a superseded decision | `bun test packages/core/test/graph.` (the `graph.*.test.ts` files) passes |
| 9 | The web UI renders the replay end to end: board, task view, timeline with a handoff joint, verification card, review card with offline badge, approval gate, memory panel with scrubber, terminal pane, dark by default | `bun run test:ui` (Playwright against the replay) passes |
| 10 | `stint bench --tasks 5 --modes transcript,packet` writes `bench/results.json` and a chart | file exists; README embeds the chart |
| 11 | The demo recording is captured from a live run and replays identically | `bun test packages/daemon/test/replay.test.ts` passes; `stint demo` runs to the end without keys |
| 12 | README quick start works on a clean machine in under 90 seconds; `docs/packet.md` and the support matrix exist; `scripts/guard-identity.mjs` passes | `scripts/bootstrap.sh` on a fresh clone exits 0; `node scripts/guard-identity.mjs` exits 0 |
| 13 | Video under 2:40 recorded from a live run; submission form filled | human check, recorded in `PROGRESS.md` under Gates |

Lines 1 to 12 are the loop's business; line 13 is the human's. The loop reports done when 1 to 12 pass and `PROGRESS.md` shows every `R-` spec `done` or `cut` by a human.

## Gates (human go/no-go, the loop pauses at each)

| Gate | End of | Passes when | If missed |
|---|---|---|---|
| 1 | Day 2, 28 Oct | The replay plays end to end in the UI with no keys | UI continues on hand-written events |
| 2 | Day 4, 30 Oct | A live Muse Code to Stint agent handoff passes verification | A second Muse Code run on another model takes the continue hop |
| 3 | Day 6, 1 Nov | Full live demo including offline review and approve | Learn step is cut |
| 4 | Day 8, 3 Nov | Video recorded, repo public-ready | Video is cut from the best rehearsal |

The loop writes `GATE n: ready for review` in `PROGRESS.md` when every spec before the gate is done, then stops. The human writes `GATE n: PASS` or `GATE n: FAIL <reason>` and restarts the loop.

## Cut order if behind

R-021 bench, then R-019 scrubber (keep the three queries as a list), then R-008 terminal pane, then R-020 learn step. **Never cut R-012 or R-013**: the kill-and-continue beat is the pitch. A cut is a human decision written as `cut` in `PROGRESS.md`.

## Budget guard

The loop stops and asks when: an iteration exceeds 90 minutes wall clock; a spec reaches 3 failed attempts; estimated spend since the last human check exceeds the figure in `scripts/loop.sh` (`MAX_USD`, default 25); or any non-negotiable in `AGENTS.md` would have to bend.
