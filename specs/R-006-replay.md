# R-006 · Replay format and replayer

Day: 2 (28 Oct) · Owner: MC · Depends on: R-004 · Fallback: timer-less dump into the log · Cut: never

## Goal
A recording format and a replayer so the UI, the CLI and every judge can see the whole demo without a single API key, and so the UI is built against real-shaped events from day 2. The recording captured from the live run on day 7 replays through the same path.

## Context
The replay is `demo/recording.jsonl`; `stint demo` emits it on a timer through the daemon. Until the live recording exists, R-006 ships a hand-written recording of the full beat sheet (T-0042 and T-0043 plus the seeded T-0040) with realistic timings, which R-022 replaces.

## Requirements
1. MUST define the recording as JSONL where each line is a `StintEvent` plus `at: <ms offset from start>` and optional `pause: true` (the replayer waits for `POST /api/demo/continue`), and a header line `{ "version": "stint.recording/1", "title", "recordedAt", "live": boolean, "tasks": [...] }`.
2. MUST implement the `replay` adapter (registered in R-004) and `packages/daemon/src/replay.ts`: `load(path)`, `play({ speed, from })`, `pause()`, `continue()`, `stop()`, emitting each event through the normal event log (so hashes, SSE and projections are real) and creating task directories as `task.created` lines arrive.
3. MUST add routes `POST /api/demo/play { path?, speed? }`, `POST /api/demo/pause`, `POST /api/demo/continue`, `POST /api/demo/stop`, `GET /api/demo/status`, and the CLI `stint demo [--speed 1] [--from 0:40]` that plays `demo/recording.jsonl` and prints the beat markers; `stint demo --live` is wired in R-022.
4. MUST mark replayed runs: every event the replayer emits carries `payload.replay: true` and the health route reports `mode: 'replay'` so the UI can show "replay of a live run on <date>".
5. MUST ship `demo/recording.jsonl` hand-written to the beat sheet (0:00 to 2:35): 2 seeded past-task events for T-0040, the full T-0042 story (plan, build with ~40 tool and file events, kill, packet, continue, verify, review with one contradiction, approve, merge, learn proposal) and T-0043 (skill applied, build, review with zero findings), ~260 events.
6. SHOULD support `speed: 0` = instant (tests) and `--from <mm:ss>` to seek by skipping timers.

## Interfaces
- `stint demo` exit 0 when the recording ends; `stint demo --from 1:05` starts at the kill.
- `GET /api/demo/status` → `{ playing, at, total, title, live }`.

## Acceptance
1. Playing the hand-written recording at `speed: 0` leaves `.stint/tasks/` with T-0040, T-0042, T-0043, a verified `events.jsonl` chain per task, and `taskBundle('T-0042')` with a killed r2 and a `handoff` of under 600 tokens: `packages/daemon/test/replay.test.ts`.
2. A client on `/api/tasks/T-0042/stream` receives the replayed events in order with correct `seq`: same file.
3. `pause: true` lines stop the replay until `continue`: same file.
4. `stint demo --from 1:05` emits the kill as its first non-header event: `packages/cli/test/demo.test.ts`.

## Verify
```
bun test packages/daemon packages/cli
./packages/cli/bin/stint demo --speed 0 --json | tail -1
```

## Out of scope
The UI (R-007), capturing a live recording (R-022).

## Notes
Write the recording by hand from the beat sheet in `AGENTS.md` section 2; the numbers must match the design mocks (412 tokens, 1.4 KB, 33 passed, $0.61 total, D3, F1, `limiter-config-via-env`). Keep agent messages short and plausible; this file is on camera. Every event must validate against `schemas/event.schema.json`.
