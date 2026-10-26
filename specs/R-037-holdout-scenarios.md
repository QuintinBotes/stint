# R-037 · Held-out scenarios and coverage

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-029

## Goal
Tests written in the same run as the code prove little. Scenarios the builder never sees are the factory's holdout set.

## Requirements
1. MUST keep scenarios outside every worktree, in `config.scenarios.dir` (default `.stint/scenarios/<task>/`), never copied into a worktree or a prompt; `stint scenario add <task> <file>` stores one.
2. MUST run them after the verify suite: copy the scenario files into a temporary checkout of the task branch (never the agent's worktree), run `config.scenarios.command` (default the task's test command filtered to those files), record `scenario.ran { passed, failed, names }`, and make the verification red when a scenario fails; the agent sees only that scenarios failed and their names, never their source.
3. MUST report a coverage delta when `config.verify.coverage` is on: the test runner's coverage summary on the base commit and on the branch, recorded in the verification record and shown on the card.

## Acceptance
1. A scenario that fails on the branch turns the verification red without the scenario file ever appearing in the worktree or prompt.md: `packages/daemon/test/scenarios.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
