# R-024 · Buffer and submit

Day: 9 (4 Nov) · Owner: Q · Depends on: R-023 · Fallback: none · Cut: never

## Goal
Nothing new is built on the last day. The loop runs in fix-only mode: red tests, broken quick start, wrong numbers in docs. The human submits by 23:00 CET on 3 November if everything is green, and by the hard deadline (4 November 9:00 PM ET, 3:00 AM on 5 November in Amsterdam) at the latest.

## Context
Official Rules read and accepted on 26 October; track chosen then (indie vs startup) and the write-up tuned to it.

## Requirements (agent part, fix-only)
1. MUST only accept work that fixes a failing Verify line of an earlier spec, a broken quick start, or a factual error in docs; any other change is refused with a note under Ideas.
2. MUST keep CI green on both OSes after every commit; a red CI blocks everything else.
3. MUST re-run `docs.claims.test.ts`, `guard-identity`, the quickstart job and `stint demo --speed 0` as the final check and record the hashes of `demo/recording.jsonl`, `bench/results.json` and the README in `PROGRESS.md` under Gates.

## Requirements (human part)
4. Public repo switched on; licence file present; `CHANGELOG.md` 0.1.0 dated.
5. Video uploaded; submission form filled from `docs/writeup.md`; confirmation saved.
6. Finals kit prepared for 9 November: live mode, replay mode, a 60-second version, three recorded packets to show if an agent misbehaves, answers to "how is this not Vibe Kanban", "why not just use Muse Code subagents", "what happens when the packet is wrong".

## Acceptance
1. `bun test` and `bun run test:ui` green; CI green on `main`: CI.
2. `PROGRESS.md` Gates show GATE 4 PASS and the three hashes.
3. Submission confirmation recorded in `PROGRESS.md` (human).

## Verify
```
bun run typecheck && bun test && bun run test:ui
./packages/cli/bin/stint demo --speed 0 --json | tail -1
```

## Out of scope
Everything else.

## Notes
If a fix needs more than an hour, ask whether to ship without it; the recording and the video already exist. Do not touch the recording on this day.
