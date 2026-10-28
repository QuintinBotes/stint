# After merge: outcomes and pull requests

This page is for anyone who wants to know what happens to a change after Stint merges it, or wants approve to open pull requests instead. The lifecycle does not stop at merge. The daemon keeps watching a merged change and records what happens to it on the task that made it, so the factory gets a signal about its own output.

## Outcomes

The daemon scans on start, every 10 minutes, and when a person calls `POST /api/outcomes/scan`. Each outcome is recorded once, however many times the scan runs.

- Reverted: a commit on the base branch whose message says `This reverts commit <sha>`, where the sha is a recorded merge commit, records `outcome.reverted` with the revert commit, the merge commit and who made the revert.
- Followed up: a task created within 7 days after another task merged, whose changed files overlap the merged task's files, records `outcome.followup` with the follow-up task and the shared files.
- Failing CI: a failed workflow run on the base branch, on a commit that carries a `Stint-Task:` trailer, records `outcome.ci` with the run id, once per run. CI is read with `gh run list`. If `gh` cannot answer, the daemon says on stderr that CI was not checked.
- Incident: a production system can report one with `POST /api/outcomes` and a body of `{ commit, kind: 'incident', summary, url }` (or a task id instead of a commit). The call needs the daemon token, like every call that changes state. The incident lands on the task the commit came from.

Outcomes show on the task itself (`outcomes` in `GET /api/tasks/:id`, and under the approval gate in the web UI), in the memory graph as a `resulted_in` edge from the merge to the outcome, and on the Factory (`/factory`), where the Outcomes panel counts merged, reverted and followed up per agent. A reverted task that had a skill mounted counts as hurt in that skill's track record on the Skills page (`/skills`).

## Pull request mode

By default approve merges locally. With a release config in `.stint/config.json`:

```json
"release": { "mode": "pr", "remote": "origin", "base": "main" }
```

approve instead pushes the task branch to the remote and opens a pull request with `gh pr create`. The title is the task title; the body is the packet summary and the same trailers a local merge commit would carry (`Stint-Task`, `Stint-Runs`, `Stint-Handoff`, `Stint-Verified`). The daemon records `release.pr_opened` with the URL and number, and the task waits in the In review lane on the Board (`/`).

A poller reads the pull request every 60 seconds (`gh pr view`), and `POST /api/tasks/:id/release/refresh` reads it on demand. Changed checks are recorded as `release.checks` with the check name and status. When the pull request merges, the daemon records `merge.completed` with the pull request's merge commit and the task is done. When a check fails, the task goes back to Needs you with the failing check named as the next ask.

What these outcomes add up to over a window (escaped defects, reverts, cost per good merge) is defined once in [`metrics.md`](metrics.md) and read with `stint metrics`.
