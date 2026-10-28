# R-063 · How it went: one outcome record per task

Day: 4 (29 Oct) · Owner: CC · Depends on: R-030, R-061, R-062 (reads its usage and limits) · Fallback: the projection, the route and `stint outcome`; the gate block only · Cut order: 3

## Goal
Stint measures the factory in aggregate (R-061) and records what happens after a merge (R-030), but nothing answers "how did this task go?" in one place. That answer covers whether each acceptance criterion was proven, how many loops it took against its limits, what it cost, how long it waited, what the review found, and whether the merge held up afterwards. This spec adds a pure projection over a task's log, `outcome()`, with a schema, a route, a CLI command and two places in the UI: the approval gate, before you merge, and the task view, after.

## Context
- Each criterion is a string in `task.acceptance`. R-064 adds `task.proofs`: per criterion, a proof of kind `test | scenario | check | human` with a `ref` (a test name or substring, a scenario name, a check name). Until R-064 lands, read `proofs` as an optional input.
- Verification is in the task's verification store and `verification.ran` (`status`, `passed`, `failed`, `failing[]` names, `checks[]`, `run`). Tests first (R-027, R-029) writes `acceptance.locked` with the tests that failed at lock time. `scenario.ran` carries `passed`, `failed` and `names`.
- Reviews are `review.recorded`, with a verdict and findings. Approval is `approval.requested`, `approval.granted` and `approval.rejected`. The merge is `merge.completed`. Outcomes are `outcome.reverted`, `outcome.followup`, `outcome.ci` and `outcome.incident`.
- The follow-up scan in `packages/daemon/src/outcomes.ts` uses a fixed `WEEK_MS`. The config has `metrics.outcomeWindowDays` (default 7), which it ignores.
- R-062 gives `taskUsage(events)` and `effectiveLimits(task, config)`. Until it lands, take `usage` and `limits` as optional inputs typed exactly as R-062 defines them.

## Definitions
**Each criterion's state, from strongest to weakest:**
- **Proven**
  - With a `test` proof: a test matching `ref` failed at some point on this task (in `acceptance.locked` failing, or in an earlier `verification.ran.failing`), and the latest verification is green.
  - With a `scenario` proof: the named scenario passed on the latest verification.
  - With a `check` proof: the named check passed on the latest verification.
  - With no proofs, when tests first locked tests that failed at lock time and the latest verification is green: every criterion counts as proven, because the locked tests were written for the criteria.
- **Passing, not proven:** the latest verification is green but nothing shows the proof failed before; or there is no proof and no tests-first lock.
- **Failing:** a `test` proof matches a name in the latest `failing`; or a named scenario or check failed; or there is no proof and the latest verification is red.
- **You check it:** the proof is of kind `human`, until the task is approved. It is then "checked by you", with who approved it.
- **Not checked:** there is no verification yet.

**Result, one per task:**
- in progress;
- waiting for you;
- stopped at a limit (`limit.reached`, R-062);
- stopped, needs you (any other `autopilot.stopped` with `needsYou`);
- rejected;
- abandoned;
- merged;
- merged, then reverted;
- merged, needed a follow-up;
- merged, CI failed;
- merged, incident.
The after-merge results apply within `outcomeWindowDays` of the merge. Once that window has passed with none of them, the result is "merged, held up".

## Requirements
1. MUST implement `outcome(input)` in `packages/core/src/project/outcome.ts`: a pure function of the task, its events, its verification records, `config`, `now`, and optional `usage`, `limits` and `proofs`. It returns `stint.outcome/1`:
   ```
   {
     version, task, result, resultLabel,
     criteria: [{ index, text, state, proof?: { kind, ref }, evidence: string }],
     loops: { builds, handoffs, reviewRounds },
     limits?,
     spend: { usd, unpriced },
     minutes,
     timeToFirstGreen?, timeToApprovalRequest?, approvalWait?, leadTime?   // ms
     review: { rounds, verdicts[], findings: { total, bySeverity } },
     handoffs: [{ from, to, packetTokens }],
     afterMerge?: { window: { days, endsAt, mature }, reverted, followups[], ci?, incidents[] }
   }
   ```
   `evidence` is one plain sentence a person can check, such as "limiter.test.ts › 429 with Retry-After failed at lock time and passes in r3". Times are measured from the first event of each kind. `leadTime` is `task.createdAt` to `merge.completed`.
2. MUST add `schemas/outcome.schema.json` (`stint.outcome/1`), its zod mirror, an example in `packages/core/schemas/examples/`, and the agreement test, as for `stint.metrics/1`.
3. MUST add `GET /api/tasks/:id/outcome` (404 for an unknown task), filling `usage` and `limits` from R-062 when they exist and `proofs` from the task.
4. MUST add `stint outcome <task> [--json]`. It prints the result line, one line per criterion with its state and evidence, then loops against limits, spend, times, the review and after-merge. `stint report` (R-047) adds an "Outcome" column with `resultLabel` for spec tasks.
5. MUST make the follow-up and incident windows in `outcomes.ts` use `config.metrics.outcomeWindowDays` instead of `WEEK_MS`, with a test showing a 3-day setting excludes a follow-up on day 4.
6. MUST show it in the web UI, following DESIGN.md (use `rev.table`, never `rev.block`; inks mean one thing each):
   - **The approval gate (`ApprovalGate.tsx`):** a "How it went" block above Approve, with:
     - the criteria, each with a plain state label in words (green only for proven, amber only for failing, ink for the rest; meaning never rests on colour alone);
     - one line: "3 builds, 1 hand-off, $0.61, 14 min to green".
     A criterion that is passing but not proven says "passes, but no test showed it failing first" and carries `Explain word="proof"`. Do not change the existing gate's evidence line or the two-press approve.
   - **The task view of a merged, rejected or abandoned task:** the same block, plus the after-merge rows, under its title block. While the outcome window is open it says "Watching for reverts and follow-ups until <date>."
   - Add `proof` to the glossary: "What shows a criterion is met: a test that failed before the change and passes after, a hidden scenario, a check, or you."
7. MUST update the docs: a "How it went" section in `docs/metrics.md` with the states and results above, `docs/verify.md` on proven against passing, and the CLI list wherever commands are listed (README, `docs/setup.md`).

## Acceptance
- Unit tests on `outcome()` with these fixtures:
  - (a) tests first locked two failing tests that are green in r2: every criterion proven, with evidence naming the tests;
  - (b) no lock and green: every criterion passing, not proven;
  - (c) a `test` proof whose test is in the latest `failing`: failing;
  - (d) a `human` proof before and after approval;
  - (e) a merge with `outcome.followup` inside the window, and one outside it;
  - (f) `limit.reached` gives "stopped at a limit".
- The schema agreement test and the example validate.
- A daemon route test for 200 and 404. A CLI test for the printed lines.
- The outcome window test for `outcomes.ts`.
- An e2e (chromium replay): T-0043 at the gate shows "How it went" with a state per criterion and the loops line; T-0042 after merge shows the after-merge rows.
- `bun run typecheck`, the unit tests, the guard and the a11y spec pass.

## Verify
`bun run typecheck && bun test packages/core packages/daemon packages/cli && node scripts/guard-identity.mjs`, then the touched Playwright specs plus `e2e/a11y.spec.ts`.

## Out of scope
A per-goal rollup (R-064 Part 2 adds it from `outcome()`), metric changes, and a new Factory section.
