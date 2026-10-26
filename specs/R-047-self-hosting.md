# R-047 · Stint builds Stint

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-017, R-025

## Goal
The build process is the product. The remaining work on Stint runs through Stint, so the repository's own `.stint/` history is evidence.

## Requirements
1. MUST add `scripts/loop.sh --self`: for a spec, `stint new` from the spec's goal and acceptance, `stint run` on autopilot, wait for Needs you, and leave approval to the person; no approval bypass flags anywhere in the loop (D-028).
2. MUST add `stint report` printing the Reviews and Spend tables PROGRESS.md expects from the workspace's own events (runs per agent, review verdicts, cost per spec), and `stint report --write` updating those tables.

## Acceptance
1. `stint report` on the replay prints the spend per task and agent and the review verdicts: `packages/cli/test/report.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
