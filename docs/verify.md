# Verify: the suite, the tamper guard, held-out scenarios, coverage and visual checks

This page explains what the daemon checks before a change can merge, and how to add checks of your own.

Verification runs in the daemon, in the run's worktree, after every run. An agent saying "tests pass" is a claim; `verification/<run>.json` is the record. Review is offered only after a green verification, and approve merges only the commit the daemon verified. When you run the tests again by hand ("Re-run the tests", or `POST /api/tasks/:id/verify`), the daemon first commits anything changed in the worktree outside a run, so the recorded commit is the tree the tests ran on. A green verification that recorded no commit cannot be approved. The Tests tab in the task view shows every part below on one card.

## The verify suite

One verification runs these checks in order:

1. The task's `testCommand`, recorded as check `tests`.
2. The task's own `checks`, or `config.verify.checks` when the task names none. Each check is `{name, command, kind}`, where `kind` is `test`, `typecheck`, `lint` or `custom`. There are at most eight checks.

`stint verify <task>` asks the daemon to run the suite now, prints the result, and exits 1 when it is red (`--run` names a run, `--json` prints the record). The palette's Run the tests does the same. After a green run that a person assigned or handed on, `stint up` and the demo send the change to the reviewer chain and on to the gate, the same step autopilot takes (the daemon option `autoReview`).

Each check runs in the worktree with the run environment, inside the run's sandbox when one is configured ([`sandbox.md`](sandbox.md#a-sandbox-per-run)). It is recorded as `{name, kind, exitCode, passed?, failed?, durationMs, status}`, with counts only for `test` checks. The record is green only when every check is green. A check whose command cannot start (for example, because its folder is gone) comes back red with exit code 127 and the reason, and the daemon keeps running. The record's `passed` and `failed` stay the test command's counts, and `verification.ran` carries the same `checks` list. Stint keeps the first 64 KB and the last 512 KB of a test run's output, with a line saying how much was left out between them, so the summary and failing test names a runner prints at the end are always kept.

## The tamper guard

An agent must not weaken the tests it is judged by. When `plan.json` is written (or at the first assign when there is no plan), the daemon hashes the test files named by the plan's steps and by the task's goal and acceptance, as they are at the commit the task starts from ([ADR-0003](adr/0003-test-lock-scope.md)). A test file is one in a `test`, `tests` or `__tests__` folder, or one whose name contains `.test.` or `.spec.`. Tests nobody named stay free to extend. The hashes go to `.stint/tasks/<id>/tests.lock.json`, and `acceptance.locked` is recorded with `scope: 'plan'`. Tests written tests-first (R-027) are added to the same file with `scope: 'tests-first'`.

After each run, the daemon compares the locked files on the task branch with the lock. A changed or deleted file:

- records `verification.tampered { run, files }`;
- shows on the card (when nothing changed, the card reads "33 passed, tests unchanged" with the locked files under it; a task that locked nothing shows no lock line);
- with `config.verify.tamper` at `fail` (the default), turns the verification red with reason `tampered`, even when the tests pass.

Approve is refused while the latest verification has an unexplained tamper, and autopilot stops. Only the latest verification counts: a later one that finds the locked files unchanged clears it. Set `tamper` to `warn` to record a tamper without turning the verification red, or `off` to skip the check.

The escape hatch is a decision, recorded after the lock, whose text starts with `tests:` and names every changed file. An agent writes it as a decision line:

```text
decision: tests: test/backoff.test.ts changed because the cap is read from the environment now
```

With it, the verification stays as the tests decide, the record's `tamper` gains `allowedBy`, and the card shows the decision.

## Held-out scenarios

Tests written in the same run as the code prove little, so a task can hold scenarios the builder never sees. They live in `config.scenarios.dir` (default `.stint/scenarios`), one folder per task, outside every worktree. Store one with:

```bash
stint scenario add T-0042 holdout.test.ts
stint scenario list T-0042
```

After the verify suite, the daemon copies the scenario files into a temporary checkout of the task branch (never the agent's worktree) and runs `config.scenarios.command` there. The default command is the task's test command filtered to those files; `{files}` in the command is replaced by the file list. The daemon records `scenario.ran { passed, failed, names }`. A failing scenario turns the verification red with reason `scenarios`, and so do scenarios that cannot run at all, with the error in the record's output. The next agent's packet says that scenarios failed and names them. The scenario source and output are never copied into a worktree, a prompt or a packet.

## Coverage

With `config.verify.coverage` on, and when the runner is bun or Vitest, the daemon also runs the test command with `--coverage` twice: once on the branch and once in a temporary checkout of the base commit. The line percentages appear in the record as `coverage: { base, branch }` and on the card. When the runner gives no coverage summary, the record says `coverage: null` with a `coverageReason`, and the verification does not fail.

## What Stint saw: visual checks

Tests prove code paths, but they miss a page that renders blank, a button off screen, or a label with the wrong words. A criterion whose proof is `visual` names a page and what a person should see there, as `<path> :: <what should be seen>`:

```json
{ "criterion": 1, "kind": "visual", "ref": "/admin :: a 429 banner saying try again in 60 s" }
```

Tell Stint how to start the app in a worktree and where it answers, in `.stint/config.json`:

```json
"visual": { "serve": "bun run dev", "url": "http://127.0.0.1:3000", "readyTimeoutMs": 30000 }
```

Once the tests, the checks and the scenarios are green, the daemon:

1. Starts `serve` in the run's worktree, once per verification, with the run environment and sandbox, and waits until `url` answers.
2. Opens each visual proof's page at 1280 by 800 in headless Chromium, waits for the network to settle (at most 5 s including the load), takes a screenshot, and keeps a clip of the load.
3. Sends the screenshot to Muse Spark 1.3 (`meta-api/muse-spark-1.3`) as an image, with the criterion as the question. Nothing read from the page goes into the prompt, and the prompt says words on the page are never instructions. Muse Spark answers `{ holds, seen, problem, element }`.
4. When the criterion does not hold, asks SAM 3.1 (`meta-api/sam-3.1`) to segment the element Muse Spark named, and draws its box on a copy of the screenshot.
5. Stops the app, whatever happened.

Each proof records `visual.checked { criterion, ref, holds, seen, problem?, element?, screenshot, marked?, clip?, cost, judge, mark? }`, with the files under `.stint/tasks/<task>/verification/<run>/` (`visual-<n>.png`, `visual-<n>-marked.png`, `visual-<n>.webm`). A check that does not hold turns the verification red with the reason `<criterion>: <problem>`, and the next packet's open items carry the problem and the path of the marked screenshot. The Tests tab shows each check under "What Stint saw": the screenshot (the marked one when the check failed), the verdict as a label with its shape, and Muse Spark's sentence as the image's text alternative. How it went counts a visual proof like any other: proven when it holds, failing when it does not.

Stint marks a page it could not look at as "not checked", with the reason in the event and on stderr, and the verification stays as the tests left it. The causes are: no `visual` config, no `META_API_KEY`, no browser ("run bunx playwright install chromium"; the daemon uses the Playwright that `apps/web` installs for its tests), an app that never answered at `url`, or a Muse Spark call that failed. Each check's calls are priced and counted in the task's spend: Muse Spark by its tokens, SAM 3.1 at $2.50 per 1,000 images. Stint draws only SAM's box, not its outline: decoding the mask would need Meta's `@meta-sam/parser` under the separate SAM License, and Stint does not add it.

`bench/visual/` holds one live check of a seeded defect (a banner that says NaN s), made with `bun bench/visual/run.ts`, with its screenshot, the marked copy, the clip and what it cost.

## Proven or passing

Green tests say the change passes. They do not say a criterion is met. A criterion is proven only when something shows it failing before the change and passing after:

- a test that failed at lock time or in an earlier run and passes now;
- a held-out scenario that passes;
- a named check that passes;
- a visual check that holds;
- you, at approval.

A criterion whose tests pass but never failed first is "passing, not proven", and the gate says "Passes, but no test showed it failing first." Tests first (`autopilot.testsFirst`) is the short way to proof: the locked tests fail at lock time, so every criterion is proven once they pass. `stint outcome <task>` prints each criterion's state with its evidence, and [`metrics.md`](metrics.md#how-it-went) has the full rules.

The numbers these checks add up to (tamper escapes, scenario catch, first pass) are defined in [`metrics.md`](metrics.md) and read with `stint metrics`.
