# R-057 · Live proofs

Day: added 27 Oct from the requirements audit · Owner: Q with the person · Depends on: R-009, R-014, R-021, R-022, R-034 · Fallback: the replay twins · Cut order: never for 1 and 2

## Goal
Run once, for real, every path whose spec named a live proof, and keep what it produced as fixtures and results, so no claim rests on a synthetic stand-in where a real run was possible.

## Context
Live tests are guarded by `STINT_LIVE=1` and have replay twins (SPEC-000). Claude Code and Codex are installed on the author's machine and can run on Muse Glimmer through Ollama (ADR-0001), so their stream fixtures need no keys. Live runs keep the machine awake (ADR-0008).

## Requirements
1. MUST record one real `claude -p --output-format stream-json` run and one real `codex exec --json` run, each on a Meta model, and replace the synthetic fixtures in their mapper tests with them, keeping the synthetic ones as extra cases.
2. MUST write the live case beside each replay twin that lacks one: the Muse Code stop (R-009 Acc 3) and the forced-compaction hook (R-014 Acc 2), guarded by `STINT_LIVE=1` and skipping with the reason when the plugin is not installed.
3. MUST run the live bench on three tasks once more on the current build and keep the rows (R-021 Acc 3).
4. MUST record the demo live with the network off at the review beat (R-022 Acc 2); that take supersedes ADR-0011 when it carries the learned skill. This step needs the person.
5. SHOULD verify `.agents/skills` against Muse Code and update the readership matrix and its health test (R-014 Acc 5).

## Acceptance
1. The Claude Code and Codex mapper tests read recorded streams: `packages/adapters/claude-code/test/map.test.ts`, `packages/adapters/codex/test/map.test.ts`.
2. The live cases exist and skip with a visible reason without `STINT_LIVE=1`: `packages/daemon/test/stop.test.ts`, `packages/daemon/test/hooks.test.ts`.
3. `bench/results.json` carries the new rows: `packages/cli/test/bench.replay.test.ts`.

## Verify
```
bash scripts/check.sh && STINT_LIVE=1 bun test packages/adapters packages/daemon/test/stop.test.ts packages/daemon/test/hooks.test.ts
```

## Out of scope
Hosted provider proofs that need keys still blocked (the Baseten 403).

## Notes
Recorded streams pass through the identity guard; a model's dashes in them are exempt as other recordings are, names and emails are not.
