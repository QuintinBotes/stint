# ADR-0003: The plan-time test lock covers the tests the plan and task name

Status: Accepted, 27 Oct 2026 (D-045). Spec: R-029 Req 2.

## Context
R-029 Req 2 locks "every test file that exists in the repository and is named by the plan's steps or by isTestPath". Locking every test file made adding a case to any existing test a tamper unless the agent wrote a decision first, which would block the factory on routine work.

## Decision
The lock covers the test files that the plan's steps and the task name and that exist at the start commit. A changed locked file fails verification as `verification.tampered` unless a decision explains it.

## Consequences
- An agent can add tests anywhere and change tests nobody named; the tests the plan relies on cannot move quietly.
- The verification card names the locked files, so a reviewer sees exactly what the lock covered.
