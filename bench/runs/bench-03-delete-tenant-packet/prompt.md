# Stint task T-0001: Delete a tenant through the admin routes

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Add DELETE /admin/tenants/:id: add a remove method to TenantRegistry in src/lib/tenants.ts, call it from src/routes/admin.ts, answer 404 for an unknown tenant, and write an audit entry for the deletion like the other admin writes. A deleted tenant must no longer be accepted by POST /webhooks. Add tests in test/admin.test.ts.

Acceptance:
- DELETE /admin/tenants/:id removes a known tenant and answers 404 for an unknown one
- The deletion writes an audit entry with the tenant
- POST /webhooks answers 404 for the deleted tenant
- The suite stays green with new tests for the delete path

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
test/admin.test.ts adds four admin API tests for DELETE /admin/tenants/:id: delete returns 204 and lists only tenant-a, unknown id returns 404 with error, deletion writes audit tenant.deleted via deps.audit.list, and POST webhooks for deleted tenant return 404. No changes to src/lib/tenants.ts TenantRegistry.remove or src/routes/admin.ts are shown, so implementation is visibly not done.
Verification by the daemon: bun run test, 27 passed, 4 failed (exit 1).
Changed: test/admin.test.ts +29 -0.
Diff: be1bee8..8558a33.

## Done
- Verification by the daemon: 27 passed, 4 failed

## Open
- Locked test files changed without a tests: decision: test/admin.test.ts. Restore them, or say on a decision: line why they had to change.

## Refused actions
- none

## Decisions
- none

## Risks
- none

## Ask of next
Next: Locked test files changed without a tests: decision: test/admin.test.ts. Restore them, or say on a decision: line why they had to change..

## Not included
- none

## Changes on the task branch so far
- test/admin.test.ts +29 -0

## Ask
Continue from the packet: start with its ask of next.
