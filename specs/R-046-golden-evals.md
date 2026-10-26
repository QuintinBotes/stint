# R-046 · Golden tasks, pass^k and phase gates

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-021, R-031

## Goal
Evals start small and real: 20 to 50 tasks from real failures, code graders first, and pass^k for work that must succeed every time.

## Requirements
1. MUST implement `bench/golden/*.json` (task, fixture commit, acceptance, grader command) and `stint eval --golden [--k 3]` running each golden task k times on fresh fixtures, grading by the daemon's verification plus scenarios, and reporting pass@1, pass^k and cost; results to `bench/golden-results.json` and `eval.ran` events.
2. MUST seed the golden set from real failures: `stint eval add-golden <task>` turns a rejected or reverted task into a golden task.
3. MUST show the phase gates in the Factory: phase 2 when the golden set passes pass^3 >= 80% with no tamper escapes; phase 3 when one risk tier has been shadow-approved for two weeks with no reverts.

## Acceptance
1. `stint eval --golden --k 3 --replay` on recorded golden runs reports pass@1 and pass^3 correctly: `packages/cli/test/eval.golden.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
