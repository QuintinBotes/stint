# R-030 · Outcomes after merge

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-017, R-018

## Goal
Give the factory a signal about its own output: whether a merged change was reverted, or needed follow-up work soon after.

## Requirements
1. MUST scan git on daemon start and every 10 minutes (and on `POST /api/outcomes/scan`): a commit on the base branch whose message reverts a `Stint-Task:` merge (git's `This reverts commit <sha>` against a merge commit carrying the trailer) emits `outcome.reverted { task, commit, by }` on that task; a later task whose changed files overlap a merged task's files within 7 days of its merge emits `outcome.followup { task, followup, files }`.
2. MUST be idempotent: each outcome is recorded once per (task, commit or followup task).
3. MUST add graph edges `resulted_in` from the merge to the outcome and expose outcomes in `GET /api/tasks/:id` (`outcomes`) and the Factory (an Outcomes panel: merged, reverted, followed up, per agent).
4. MUST feed outcomes into skill track records (R-031): a reverted task with a skill mounted counts as hurt.

## Acceptance
1. A fixture repo where a Stint-Task merge is reverted yields exactly one `outcome.reverted` after two scans: `packages/daemon/test/outcomes.test.ts`.
2. A second task touching the first's files within 7 days yields `outcome.followup`; one after 8 days does not: same file.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
