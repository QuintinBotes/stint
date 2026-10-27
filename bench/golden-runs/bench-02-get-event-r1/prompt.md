# Stint task T-0001: Get one stored event by id

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Add GET /events/:id in src/routes/events.ts: it returns the stored event as JSON when the X-Tenant header names the tenant that owns it, 400 when the header is missing, and 404 when the event does not exist or belongs to another tenant. Use the existing EventStore. Add tests in test/events.test.ts.

Acceptance:
- GET /events/:id returns the event for its owning tenant
- Another tenant asking for the same id gets 404
- A missing X-Tenant header gets 400
- The suite stays green with new tests for all three cases

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Changes on the task branch so far
None yet.

## Ask
Implement the goal. Follow the plan where there is one.
