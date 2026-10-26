# R-022 · Demo seeding and recording

Day: 7 (2 Nov) · Owner: Q with Q · Depends on: R-006, R-020 · Fallback: a hand-edited recording · Cut: never

## Goal
The demo state and the real recording: T-0040's history seeded as if done last week, T-0042 and T-0043 defined, `stint demo --live` running the beat sheet for real with the network off for the review leg, and the live run captured into `demo/recording.jsonl` so `stint demo` replays exactly what happened. The replay is what judges click; the video is cut from the live run.

## Context
Beat sheet in `AGENTS.md` section 2; the hand-written recording from R-006 is replaced here. Seed data must make the learn step fire (T-0040's review carries finding F2 on the same risk as T-0042's F1).

## Requirements
1. MUST implement `stint demo seed`: on the fixture copy, create T-0040 (done; events, a review with F2 "limits hard-coded, no jitter", a merged commit with trailers from F-001), T-0042 (planned, with the three acceptance criteria and `bun test` as test command) and T-0043 (planned, "Rate-limit the admin API"), plus `context.json` for T-0042 naming the webhook route files; idempotent.
2. MUST implement `stint demo --live [--from <beat>]`: a scripted runner that executes the beat sheet through the daemon API with pauses at each beat (`Enter` to continue, or `--auto` with timings): voice input stubbed with the known text unless `--mic` (Muse Voice Transcribe when available; otherwise typed), plan with Wonder (the planner chain falls to `fireworks/muse-spark-open` on a 429 and the UI chip says so; `--offline-plan` forces local Glimmer), assign Muse Code, kill at the planned step by `pkill -9` of the run's process group (the terminal pane shows it), hand to the Stint agent, verify, network off prompt for the review leg (the runner checks connectivity and refuses to continue the review beat while online unless `--allow-online`), review with Ollama, approve and merge, learn, approve the skill, assign T-0043, review, close with the totals.
3. MUST implement `stint demo record --out demo/recording.jsonl`: subscribe to `/api/stream` and every task stream during the live run and write the recording format from R-006 with real timings, `live: true`, `recordedAt`, and the git commit; `stint demo` then replays this file by default.
4. MUST verify the replay reproduces the live packet: the recording's `handoff.created` for r2 carries the same hash as `handoffs/h1.json` from the live run, and `stint demo --speed 0` rebuilds a task bundle whose packet matches token count and hash.
5. MUST keep the demo offline-safe: `stint demo` (replay) needs no keys and no Ollama; the UI shows "Replay of a live run on <date>" from the header; `--live` lists which keys and models it needs before starting (`META_API_KEY`, Ollama with Glimmer pulled; `BASETEN_API_KEY` and `FIREWORKS_API_KEY` optional but recommended so the planner and learn chains have a hosted Spark Open fallback) and refuses to start with a required one missing, naming it.
6. SHOULD capture three recordings (three rehearsals) under `demo/recordings/<date>-<n>.jsonl` and let `stint demo --take 2` pick one; the best becomes `demo/recording.jsonl`.

## Interfaces
- `stint demo seed [--repo <path>]`, `stint demo --live [--auto] [--from 1:05] [--allow-online] [--mic]`, `stint demo record --out <file>`, `stint demo [--take n] [--speed] [--from]`.

## Acceptance
1. `stint demo seed` twice on a fixture copy leaves exactly three tasks with T-0040 `done` and a merged commit carrying `Stint-Task: T-0040`: `packages/cli/test/demo.seed.test.ts`.
2. `stint demo --live --auto` with `STINT_LIVE=1`, keys present and Ollama up completes all beats, writes a recording, and the resulting T-0042 packet is under 600 tokens with `endedBy: 'killed'` for r2: `packages/cli/test/demo.live.test.ts` (skips with reason otherwise).
3. Replaying the captured recording at speed 0 yields a T-0042 bundle whose `handoff.hash` equals the live run's: `packages/daemon/test/replay.fidelity.test.ts`.
4. `stint demo --live` with `META_API_KEY` unset refuses to start and names the key: `packages/cli/test/demo.preflight.test.ts`.
5. The review beat refuses to run while online unless `--allow-online`: same file.

## Verify
```
bun test packages/cli packages/daemon
./packages/cli/bin/stint demo --speed 0 --json | tail -1
```

## Out of scope
Video editing, the README (R-023).

## Notes
Rehearse three times and keep all three recordings; the write-up says which take the video used. The kill must be a real `SIGKILL` to the process group so the "in-flight step unknown" line is real. The network-off check reads the OS (`networksetup` on macOS, `nmcli` or `/sys/class/net` on Linux) and is advisory: it refuses, it does not toggle anything.
