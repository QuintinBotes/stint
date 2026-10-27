# Verify: the suite, the tamper guard, held-out scenarios and coverage

Verification runs in the daemon, in the run's worktree, after every run. An agent saying "tests pass" is a claim; `verification/<run>.json` is the record. Review is offered only after a green verify, and approve merges only the commit the daemon verified. The verification tab shows every part below on one card.

## The verify suite

One verification runs a suite of checks, in order:

1. The task's `testCommand`, recorded as check `tests`.
2. The task's own `checks`, or `config.verify.checks` when the task names none. Each check is `{name, command, kind}`, with `kind` one of `test`, `typecheck`, `lint`, `custom`. Eight checks at most.

Each check runs in the worktree with the run environment and is recorded as `{name, kind, exitCode, passed?, failed?, durationMs, status}` (counts only for `test` checks). The record is green only when every check is green. The record's `passed` and `failed` stay the test command's counts, and `verification.ran` carries the same `checks` list.

## The tamper guard

An agent must not weaken the tests it is judged by. When `plan.json` is written (or at the first assign when there is no plan), the daemon hashes every test file in the repository at the commit the task starts from: the ones the plan's steps name, and every file in a test folder or named `.test.` or `.spec.`. The hashes go to `.stint/tasks/<id>/tests.lock.json`, and `acceptance.locked` is recorded with `scope: 'plan'`. Tests written tests-first (R-027) are added to the same file with `scope: 'tests-first'`.

After each run the daemon compares the locked files on the task branch with the lock. A changed or deleted file records `verification.tampered { run, files }`, shows on the card ("tests unchanged: test/webhooks.test.ts" when nothing changed; no line at all when the task locked nothing), and, with `config.verify.tamper` at `fail` (the default), turns the verification red with reason `tampered` even when the tests pass. Approve is refused while a tamper stands unexplained, and autopilot stops. Set `tamper` to `warn` to record it without turning the verification red, or `off` to skip the check.

The escape hatch: a decision recorded after the lock whose text starts with `tests:` and names every changed file. An agent writes it as a decision line:

```
decision: tests: test/backoff.test.ts changed because the cap is read from the environment now
```

With it, the verification stays as the tests decide, the record's `tamper` gains `allowedBy`, and the card reads the decision.

## Held-out scenarios

Tests written in the same run as the code prove little, so a task can hold scenarios the builder never sees. They live in `config.scenarios.dir` (default `.stint/scenarios`), one folder per task, outside every worktree. Store one with:

```
stint scenario add T-0042 holdout.test.ts
stint scenario list T-0042
```

After the verify suite, the daemon copies the scenario files into a temporary checkout of the task branch (never the agent's worktree), runs `config.scenarios.command` there (default: the task's test command filtered to those files; `{files}` in the command is replaced by the file list), and records `scenario.ran { passed, failed, names }`. A failing scenario turns the verification red with reason `scenarios`. The next agent learns from its packet that scenarios failed, and their names; the scenario source and output are never copied into a worktree, a prompt or a packet.

## Coverage

With `config.verify.coverage` on, the daemon also runs the test command with `--coverage` when the runner is bun or Vitest: once on the branch, once in a temporary checkout of the base commit. The line percentages land in the record as `coverage: { base, branch }` and on the card. When the runner gives no coverage summary, the record says `coverage: null` with a `coverageReason`, and the verification does not fail for it.
