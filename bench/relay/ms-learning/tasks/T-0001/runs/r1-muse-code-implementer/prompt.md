# Stint task T-0001: Add toSeconds()

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `npm run test:nodejs && npm run test:edge` itself. A claim that the tests pass is not the record.

## Goal
Export `toSeconds(value)` from src/index.ts: the whole number of seconds, rounded down, in a duration string or a number of milliseconds.

Acceptance:
- `toSeconds('90s')` is 90, `toSeconds('2m')` is 120 and `toSeconds(1500)` is 1.
- README.md documents it.
- Both test runs pass with coverage at 100%.

## Skills mounted for this run
None.

## Plan
No plan was made for this task.

## Changes on the task branch so far
None yet.

## Ask
Implement the goal. Follow the plan where there is one.
