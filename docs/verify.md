# Verify: the suite, the tamper guard, held-out scenarios and coverage

This page is for anyone who wants to know what the daemon checks before a change can merge, and how to add checks of their own. Verification runs in the daemon, in the run's worktree, after every run. An agent saying "tests pass" is a claim; `verification/<run>.json` is the record. Review is offered only after a green verify, and approve merges only the commit the daemon verified. When you run the tests again by hand ("Re-run the tests", or `POST /api/tasks/:id/verify`), the daemon first commits anything changed in the worktree outside a run, so the commit it records is the tree the tests ran on. A green verification that recorded no commit cannot be approved. The Tests tab in the task view shows every part below on one card.

## The verify suite

One verification runs a suite of checks, in order:

1. The task's `testCommand`, recorded as check `tests`.
2. The task's own `checks`, or `config.verify.checks` when the task names none. Each check is `{name, command, kind}`, with `kind` one of `test`, `typecheck`, `lint`, `custom`. Eight checks at most.

Each check runs in the worktree with the run environment, in the run's sandbox when one is configured ([`sandbox.md`](sandbox.md#a-sandbox-per-run)), and is recorded as `{name, kind, exitCode, passed?, failed?, durationMs, status}` (counts only for `test` checks). The record is green only when every check is green. The record's `passed` and `failed` stay the test command's counts, and `verification.ran` carries the same `checks` list. A test run's output is kept as its first 64 KB and its last 512 KB, with a line saying how much was left out between them, so the summary and failing names a runner prints at the end are always kept.

## The tamper guard

An agent must not weaken the tests it is judged by. When `plan.json` is written (or at the first assign when there is no plan), the daemon hashes the test files that the plan's steps and the task's goal and acceptance name, as they are at the commit the task starts from ([ADR-0003](adr/0003-test-lock-scope.md)). A test file is one in a `test`, `tests` or `__tests__` folder, or one named `.test.` or `.spec.`. Tests nobody named stay free to extend. The hashes go to `.stint/tasks/<id>/tests.lock.json`, and `acceptance.locked` is recorded with `scope: 'plan'`. Tests written tests-first (R-027) are added to the same file with `scope: 'tests-first'`.

After each run the daemon compares the locked files on the task branch with the lock. A changed or deleted file records `verification.tampered { run, files }`, shows on the card ("33 passed, tests unchanged", with the locked files under it, when nothing changed; no lock line at all when the task locked nothing), and, with `config.verify.tamper` at `fail` (the default), turns the verification red with reason `tampered` even when the tests pass. Approve is refused while the latest verification has an unexplained tamper, and autopilot stops. Only the latest verification counts: a later one that finds the locked files as they were clears it. Set `tamper` to `warn` to record it without turning the verification red, or `off` to skip the check.

The escape hatch: a decision recorded after the lock whose text starts with `tests:` and names every changed file. An agent writes it as a decision line:

```text
decision: tests: test/backoff.test.ts changed because the cap is read from the environment now
```

With it, the verification stays as the tests decide, the record's `tamper` gains `allowedBy`, and the card reads the decision.

## Held-out scenarios

Tests written in the same run as the code prove little, so a task can hold scenarios the builder never sees. They live in `config.scenarios.dir` (default `.stint/scenarios`), one folder per task, outside every worktree. Store one with:

```bash
stint scenario add T-0042 holdout.test.ts
stint scenario list T-0042
```

After the verify suite, the daemon copies the scenario files into a temporary checkout of the task branch (never the agent's worktree), runs `config.scenarios.command` there (default: the task's test command filtered to those files; `{files}` in the command is replaced by the file list), and records `scenario.ran { passed, failed, names }`. A failing scenario turns the verification red with reason `scenarios`. The next agent learns from its packet that scenarios failed, and their names; the scenario source and output are never copied into a worktree, a prompt or a packet.

## Coverage

With `config.verify.coverage` on, the daemon also runs the test command with `--coverage` when the runner is bun or Vitest: once on the branch, once in a temporary checkout of the base commit. The line percentages land in the record as `coverage: { base, branch }` and on the card. When the runner gives no coverage summary, the record says `coverage: null` with a `coverageReason`, and the verification does not fail for it.

## Proven or passing

Green tests say the change passes. They do not say a criterion is met. A criterion is proven only when something shows it failing before the change and passing after: a test that failed at lock time or in an earlier run and passes now, a held-out scenario that passes, a named check that passes, or you at approval. A criterion whose tests pass but never failed first is "passing, not proven", and the gate says "Passes, but no test showed it failing first." Tests first (`autopilot.testsFirst`) is the short way to proof: the locked tests fail at lock time, so every criterion is proven once they pass. `stint outcome <task>` prints each criterion's state with its evidence, and [`metrics.md`](metrics.md#how-it-went) has the full rules.

The numbers these checks add up to (tamper escapes, scenario catch, first pass) are defined once in [`metrics.md`](metrics.md) and read with `stint metrics`.
