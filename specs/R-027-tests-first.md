# R-027 · Done means failing tests first

Day: 1 (26 Oct) · Owner: Q · Depends on: R-025 · Fallback: off by default · Cut order: 7

## Goal
"Done" stops being the model's opinion. Before anything is built, an agent writes tests for the task's acceptance criteria that fail now, for the right reason. The daemon locks them. The build is done when those tests pass and nobody changed them. If the tests pass before any change, the task may be done already and the person is asked.

## Requirements
1. MUST add `autopilot.testsFirst` (default false) and a `specify` step between plan and build: the first available implementer gets an ask to write tests for the acceptance criteria only, under the repository's test folder, changing no source file.
2. MUST judge the specify run by the daemon's verification: red with named failing tests and no load error (syntax error, missing module) locks the tests; green stops autopilot with "Needs you: the acceptance tests pass before any change"; red without a named failing test, or with a load error, stops with "Needs you: the new tests do not run" and the first error line.
3. MUST lock by recording `acceptance.locked { run, files: [{ path, sha256 }], failing }`, the test files the specify run added or changed, hashed at the task branch head.
4. MUST check the lock after every later run: a locked file whose hash changed on the task branch records `acceptance.tampered { run, files }`, and autopilot stops with "Needs you: <agent> <run> changed the acceptance tests".
5. MUST count only implementer runs after the lock for hand-offs and stuck detection.

## Acceptance
1. With testsFirst on and fake adapters, the steps are plan, specify, build, verify, review, and `acceptance.locked` names the test file with its hash: `packages/daemon/test/tests-first.test.ts`.
2. A specify run whose tests already pass stops autopilot with the "pass before any change" reason: same file.
3. A build run that edits a locked test file records `acceptance.tampered` and stops autopilot: same file.

## Out of scope
Mapping each criterion to a named test; mutation testing.
