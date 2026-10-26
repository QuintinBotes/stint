# R-044 · Scheduled upkeep tasks

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-025

## Goal
Agent-written code drifts. Upkeep runs through the same queue as everything else.

## Requirements
1. MUST create tasks on `config.gardening.schedule` (daily or weekly) from `config.gardening.tasks` plus two built-ins: doc gardening (README, AGENTS.md and docs/ against the code: stale commands, dead links) and dead-code and dependency drift; each with `source.kind: 'gardening'` and the tag `gardening`, never two open at once for the same template.
2. MUST let gardening tasks go through autopilot and the gate like any other; the Factory shows when the next one is due.

## Acceptance
1. With a weekly schedule and a clock moved forward, exactly one doc-gardening task is created and none twice: `packages/daemon/test/gardening.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
