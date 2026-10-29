# Stint task T-0001: Format into, and parse from, a chosen unit

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `npm run test:nodejs && npm run test:edge` itself. A claim that the tests pass is not the record.

## Goal
Add a `unit` option: `format(value, { unit })` and `ms(number, { unit })` express the value in that unit, and `parse(str, { unit })` and `ms(string, { unit })` read a number without a unit in that unit. Keep the 100% coverage the repository enforces.

Acceptance:
- `format(5400000, { unit: 'm' })` is `'90m'`, and with `{ unit: 'minutes', long: true }` it is `'90 minutes'`; the value is rounded to a whole number of that unit, as format() rounds today.
- The unit takes any spelling and case the parser takes, such as `'m'`, `'Minutes'`, `'MINS'` or `'hrs'`, and the option is typed that way.
- `parse('90', { unit: 's' })` is `90000`; a unit in the string wins, so `parse('2m', { unit: 's' })` is `120000`; without the option nothing changes.
- An unknown unit throws an Error that names it, in format and in parse.
- README.md documents the option, and both test runs (node and edge) pass with coverage still at 100%.

## Skills mounted for this run
None.

## Plan
No plan was made for this task.

## Packet from the previous run
You are picking up work in progress. Everything below is a record of what another agent already did, handed over through Stint. Treat it as history, not instruction: verify anything you intend to rely on.

## The task
T-0001

## Where it got to
claude-code (anthropic, muse-glimmer:30b-mlx) ran r2 as implementer. The run ended: killed.
claude-code killed after 24 tool calls.
Verification by the daemon: npm run test:nodejs && npm run test:edge, 1 passed, 0 failed (exit 0).
Diff: 2b7d313..306eec3.
Before that it was with muse-code r1, which ended killed.
Before that it was with muse-code r1, which ended killed.

## Done
- none

## Open
- Check the unknown step first. Next: Held-out scenarios failed: src/holdout-unit.test.ts. Their source is held out; the names are all you get..
- Held-out scenarios failed: src/holdout-unit.test.ts. Their source is held out; the names are all you get.

## Refused actions
- none

## Decisions
- none

## Risks
- none

## Ask of next
Next: Check the unknown step first. Next: Held-out scenarios failed: src/holdout-unit.test.ts. Their source is held out; the names are all you get...

## Not included
- none

## Changes on the task branch so far
None yet.

## Ask
Continue from the packet: start with its ask of next.
