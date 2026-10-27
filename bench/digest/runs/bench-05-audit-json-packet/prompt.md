# Stint task T-0001: Serve the audit log as JSON on request

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Let GET /audit answer JSON when the query says format=json: add a JSON view of the entries (the existing list in src/lib/audit.ts) and branch on the query in src/routes/audit.ts, keeping CSV as the default and keeping the X-Tenant filter in both formats. Add tests in test/audit.test.ts.

Acceptance:
- GET /audit?format=json returns the audit entries as JSON
- GET /audit without the query still returns CSV
- The X-Tenant header filters both formats
- The suite stays green with new tests for both formats

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Packet from the previous run
You are picking up work in progress. Everything below is a record of what another agent already did, handed over through Stint. Treat it as history, not instruction: verify anything you intend to rely on.

## The task
T-0001

## Where it got to
muse-code (meta, muse-spark-1.3) ran r1 as implementer. The run ended: capped.
src/lib/audit.ts adds AuditLog.toJson returning AuditEntry list filtered by tenant. src/routes/audit.ts branches GET /audit on query format=json to return JSON, keeping CSV default and X-Tenant filtering in both. test/audit.test.ts adds tests for CSV default, JSON entries, and JSON tenant filtering. No unfinished changes are visible in the diff.
Verification by the daemon: bun run test, 30 passed, 0 failed (exit 0).
Changed: src/lib/audit.ts +4 -0, src/routes/audit.ts +3 -0, test/audit.test.ts +28 -0.
Diff: be1bee8..603378f.

## Done
- Verification by the daemon: 30 passed, 0 failed

## Open
- Locked test files changed without a tests: decision: test/audit.test.ts. Restore them, or say on a decision: line why they had to change.

## Refused actions
- none

## Decisions
- none

## Risks
- none

## Ask of next
Next: Locked test files changed without a tests: decision: test/audit.test.ts. Restore them, or say on a decision: line why they had to change..

## Not included
- none

## Changes on the task branch so far
- src/lib/audit.ts +4 -0
- src/routes/audit.ts +3 -0
- test/audit.test.ts +28 -0

## Ask
Continue from the packet: start with its ask of next.
