# R-029 · Verify suite and the tamper guard

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-005, R-010, R-027

## Goal
Make "verification the agent cannot fake" literally true. The daemon runs a suite of checks (tests, typecheck, lint), not one command, and an agent that weakens the tests it is judged by fails verification.

## Requirements
1. MUST run the verify suite after every run: the task's `testCommand` as check `tests`, then `task.checks` or `config.verify.checks` in order (each `{name, command, kind}`), each in the run's worktree with the run environment, recorded in the verification record as `checks: [{name, kind, exitCode, passed?, failed?, durationMs, status}]`; the record is green only when every check is green.
2. MUST hash at plan time (when `plan.json` is written, or at the first assign when there is no plan) every test file that exists in the repository and is named by the plan's steps or by `isTestPath`, storing `{path, sha256}` in `.stint/tasks/<id>/tests.lock.json` and emitting `acceptance.locked` with `scope: 'plan'`.
3. MUST, after each run, compare those files on the task branch with the lock; a changed or deleted locked file emits `verification.tampered { run, files }` and, with `config.verify.tamper` `fail` (the default), marks the verification red with reason `tampered`, unless a `decision.recorded` after the lock names every changed file and says why (the escape hatch: the agent writes `decision: tests: <file> changed because <reason>`).
4. MUST show in the verification tab and card the line "tests unchanged" (or the changed files and the decision that allowed them), each check's result, and refuse approve while a tamper stands unexplained.
5. MUST keep R-027's tests-first lock working: the plan-time lock and the tests-first lock are one file, tests-first adds the tests it wrote.

## Acceptance
1. A run that edits a locked test file without a decision ends with `verification.tampered` and a red verification even though the tests pass: `packages/daemon/test/verify.tamper.test.ts`.
2. The same edit with a `decision: tests: test/x.test.ts changed because ...` line is allowed and the card reads the decision: same file.
3. A task with `checks: [{name:'typecheck', command:'...', kind:'typecheck'}]` records both checks and is red when only the typecheck fails: `packages/daemon/test/verify.suite.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
