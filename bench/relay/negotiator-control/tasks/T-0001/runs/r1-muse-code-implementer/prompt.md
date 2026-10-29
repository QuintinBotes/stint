# Stint task T-0001: No Accept header means no media type

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `npm test` itself. A claim that the tests pass is not the record.

## Goal
When a request has no Accept header, `mediaType()` returns undefined and `mediaTypes()` returns an empty list, so a server can tell a client that asked for nothing from one that accepts anything.

Acceptance:
- With no Accept header, `mediaType()` is `undefined` and `mediaTypes()` is `[]`.
- With a list of available types and no Accept header, `mediaType(list)` still returns the first item.
- The existing tests in test/mediaType.js stay exactly as they are.

## Skills mounted for this run
None.

## Plan
No plan was made for this task.

## Changes on the task branch so far
None yet.

## Ask
Implement the goal. Follow the plan where there is one.
