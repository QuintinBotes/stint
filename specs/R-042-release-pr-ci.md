# R-042 · Release: pull requests, CI and production signals

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-017, R-030

## Goal
The lifecycle does not stop at merge.

## Requirements
1. MUST support `config.release.mode: 'pr'`: approve pushes the task branch to `release.remote` and opens a pull request with `gh pr create` (title, the packet summary, the trailers in the body), emitting `release.pr_opened { url, number }`; the task waits in a new lane, In review, until the PR merges.
2. MUST poll the PR's checks and status (`gh pr checks`, `gh pr view --json`) and record `release.checks { name, status }`; a merged PR completes the task (`merge.completed` with the PR's merge commit); failing checks move the task back to Needs you with the failing check named.
3. MUST link CI on the base branch to tasks: a failed workflow run on a commit that carries `Stint-Task` records `outcome.ci { task, run, status }`; and accept production signals at `POST /api/outcomes { commit | task, kind: 'incident', summary, url }` recording `outcome.incident` on the task the commit came from.

## Acceptance
1. With a fake `gh`, approve in PR mode records `release.pr_opened`, failing checks return the task to Needs you, and a merged PR completes it: `packages/daemon/test/release.test.ts`.
2. `POST /api/outcomes` with a merge commit records the incident on the right task: same file.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
