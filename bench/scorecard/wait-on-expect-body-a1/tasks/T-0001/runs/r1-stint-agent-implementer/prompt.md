# Stint task T-0001: Match HTTP response bodies

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `npm test` itself. A claim that the tests pass is not the record.

## Goal
Add an `expectBody` option (a substring, or a RegExp in the API) and a `--expect-body` CLI flag, so `http-get:` and `https-get:` resources count as available only once the response body contains the text.

Acceptance:
- Against a local server, `expectBody` on an `http-get:` resource keeps waiting while the GET body does not contain the text, then succeeds once it does; a RegExp works the same way in the API.
- It fails with the usual timeout error when the body never matches.
- The options check rejects `expectBody` on a HEAD (`http:` or `https:`) resource straight away, with a clear message that names `expectBody` and the `-get` form to use instead.
- The CLI takes `--expect-body <text>`, exits 0 once the body matches and non-zero on a timeout.
- bin/usage.txt, README.md and index.d.ts document the option, the type tests cover it, and `npm test` (lint, types and mocha) passes.

## Skills mounted for this run
None.

## Plan
No plan was made for this task.

## Changes on the task branch so far
None yet.

## Ask
Implement the goal. Follow the plan where there is one.
