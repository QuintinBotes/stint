# R-017 · Approve, merge, trailers

Day: 6 (1 Nov) · Owner: Q · Depends on: R-005, R-012 · Fallback: mark done without merging · Cut: never

## Goal
Approval is a real merge with commit trailers any tool can read, rejection re-opens the task with the reason as the next ask, and a sign-off record is written. After this spec the repo can build Stint with Stint: every kit task becomes a `.stint/` task and merges carry `Stint-Task` trailers, which becomes the depth evidence in the write-up.

## Context
Trailer format from the spec doc: `<title>\n\nStint-Task: T-0042\nStint-Runs: r1,r2,r3,r4\nStint-Handoff: sha256:...` plus `Stint-Verified: <command> <passed>/<total>`. Entire's checkpoints and `git log --format` can find the task; `stint show <commit>` opens it. The interop rows (AGENTS.md, `.agents/skills`, Entire, Beads) are each about an hour and belong here.

## Requirements
1. MUST implement `POST /api/tasks/:id/approve { squash?: boolean }`: refuse unless the latest verification is green (`verification_red`) and the latest review is not `block` (`review_blocked`) and no run is active; fast-forward or merge `stint/<task>` into the base branch (`--no-ff` with the message below, or squash when asked), with trailers `Stint-Task`, `Stint-Runs`, `Stint-Handoff` (latest packet hash), `Stint-Verified`; emit `approval.granted` and `merge.completed { branch, commit, trailers }`; write `signoff.json` `{ by, at, verificationHash, commit }`; set status `done`; remove the worktree (never `--force`; keep the branch for 7 days); then start the learn step (R-020; until then emit `learn.skipped`).
2. MUST implement `POST /api/tasks/:id/reject { reason }`: record `decision.recorded { text: 'Rejected: <reason>' }` and `approval.rejected`, set status `building`, and store the reason as the pending `askOfNext` for the next assign.
3. MUST implement `POST /api/tasks/:id/request-changes { text }`: like reject but status `building` with the text as the ask and no decision entry.
4. MUST implement `stint approve <task> [--squash]`, `stint reject <task> --reason "…"`, `stint show <commit>` (reads the trailers and prints the task, runs and packet path), and `stint export <task> --format zip|entire` (the task folder as a zip, or `packet.json` plus a checkpoint-style pairing file for Entire).
5. MUST implement the interop hooks: `links.beadsId` on the task and `stint new --from-bead <id>` (reads `bd show <id> --json` when `bd` exists, copies title and description); `links.issueUrl` accepted and shown; the `## Stint` AGENTS.md section from R-014 is refreshed on approve with the latest merged task.
6. MUST make the merge work on both macOS and Linux CI against the fixture, including a conflict case: a conflicting base change returns `merge_conflict` with the files, leaves the tree clean, and keeps the task at `awaiting_approval`.
7. SHOULD switch the kit's own loop to Stint from this point: `scripts/loop.sh --self` uses `stint new`/`assign`/`hand`/`approve` instead of raw `muse exec`, so the repo's `.stint/` history records the rest of the build.

## Interfaces
- Merge message: `<task title> (<task id>)\n\n<packet summary>\n\nStint-Task: <id>\nStint-Runs: <r1,r2,…>\nStint-Handoff: <hash>\nStint-Verified: <command> <passed>/<passed+failed>`.
- Errors: `verification_red`, `review_blocked`, `merge_conflict { files }`, `run_active`.

## Acceptance
1. Approving the replayed T-0042 on the fixture copy produces one commit on `main` whose body carries all four trailers and `git log -1 --format=%B` contains `Stint-Task: T-0042`: `packages/daemon/test/approve.test.ts`.
2. Approve with a red verification returns 409 `verification_red` and changes nothing: same file.
3. Reject writes the decision, sets `building`, and the next `assign`'s `prompt.md` contains the reason under `## Ask of next`: `packages/daemon/test/reject.test.ts`.
4. A conflicting base commit yields `merge_conflict` with the file list and a clean tree: `packages/daemon/test/merge.conflict.test.ts`.
5. `stint show <commit>` prints the task id, runs and packet path from the trailers: `packages/cli/test/show.test.ts`.

## Verify
```
bun test packages/daemon packages/cli
```

## Out of scope
The learn step content (R-020), UI (R-016 already wired the gate).

## Notes
Use `git merge --no-ff -F <file>` so the message is exact; `--squash` then `git commit -F`. Keep `signoff.json` tiny; it is shown on the merged card. The 7-day branch retention is a note in `config.json`, not a cron job, in this window.
