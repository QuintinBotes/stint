# R-035 · Escalation, best-of-n and the cross-vendor review rule

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-025

## Goal
Hand-offs that get smarter: escalate after repeated failure, build twice and keep the better, and never let an agent review its own work.

## Requirements
1. MUST escalate: when a task's verification has failed `autopilot.escalateAfter` times (default 2) since the lock or start, autopilot's next hop goes to the first available entry of `autopilot.escalate` (an agent id, or `stint-agent@host/model`) with the failed packet, emitting `escalation.triggered { from, to, failures }`.
2. MUST implement best-of-n: with `autopilot.bestOf` = n > 1, the build step starts n implementers from the same packet in n worktrees (`stint/<task>-b<k>` branches), the daemon verifies each, the reviewer is asked to pick among the green ones (a review with `pick`), the picked branch becomes the task branch, the others are kept but not merged; events `bestofn.started`, `bestofn.picked { pick, reason }`.
3. MUST refuse a review (`review_blocked` with a reason) when `review.crossVendor` is on (the default) and the reviewer's harness and model both equal the last implementer's; the UI and autopilot pick the next reviewer in the chain instead.

## Acceptance
1. Two failed verifications hand the third run to the escalate entry: `packages/daemon/test/escalate.test.ts`.
2. bestOf 2 runs two fakes, verifies both, picks the green one: `packages/daemon/test/bestofn.test.ts`.
3. A reviewer equal to the implementer is refused and the next one is used: `packages/daemon/test/review.crossvendor.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
