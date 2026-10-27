# R-005 · Worktree manager and verifier

Day: 1 (27 Oct) · Owner: Q · Depends on: R-003 · Fallback: run in a repo copy instead of a worktree · Cut: never

## Goal
Every run happens in its own git worktree on the task branch, the daemon snapshots the diff into events while the run lives, commits the worktree state when it ends, and verifies by running `testCommand` itself. This is the mechanism behind "the agent doesn't grade its own work" and the kill beat's "the packet is built from the tree, not the transcript".

## Context
Lifecycle in `docs/verify.md` and `docs/sandbox.md`. Refusal cases follow an earlier terminal project's git service and AGENTS.md "Where a Thread works": never `--force` on cleanup, refuse repos with no commits and untracked directories in the way.

## Requirements
1. MUST implement `packages/daemon/src/worktree.ts`: `create(task, runId)` → `git worktree add .stint/worktrees/<task>-<run> -b stint/<task> <baseCommit>` on the first run, `git worktree add … stint/<task>` on later runs after the previous worktree is removed; `remove(task, runId)` never passes `--force` and refuses (`run_active`) while a process holds the directory; `diff(task)` → `git diff <baseCommit>..stint/<task>` as unified and as `--numstat` JSON.
2. MUST refuse `create` with `dirty_tree` when the main tree has uncommitted tracked changes, with `no_commits` when HEAD does not exist, and with `path_in_use` when `.stint/worktrees/<task>-<run>` exists and is not a registered worktree; each refusal is a `run.refused` event with `payload.code` and `payload.hint`.
3. MUST snapshot `git diff --numstat` into `file.changed` events every 5 s while a run is active (only when changed) and once at the end.
4. MUST commit the worktree state on `run.finished` as `wip(<task> <run>): <summary or endedBy>` so the branch always carries the history and `diff` never depends on a live process.
5. MUST implement `packages/daemon/src/verifier.ts`: `verify(task, runId)` runs `task.testCommand` in the worktree with a 10-minute cap and the run's environment, captures exit code and output, parses `passed`/`failed` from Vitest (`Tests  N passed | M failed`) and `bun test` (`N pass`, `M fail`) with a generic exit-code fallback, writes `verification/<run>.json` `{ command, exitCode, passed, failed, durationMs, runBy: 'daemon', outputRef }` and emits `verification.ran`.
6. MUST add routes `POST /api/tasks/:id/verify` and `GET /api/tasks/:id/diff?format=unified|json`, and a `runs` registry in the daemon so `run_active` is enforceable.
7. SHOULD set `STINT_TASK`, `STINT_RUN`, `STINT_WORKTREE`, `TERM_PROGRAM=Stint` in the environment of anything the daemon spawns in a worktree, and strip agent session markers (`MUSE_*`) so a spawned agent starts clean.

## Interfaces
```ts
export interface WorktreeManager { create(task: Task, run: string): Promise<{ path: string; branch: string }>; remove(task: Task, run: string): Promise<void>; diff(task: Task, format: 'unified' | 'json'): Promise<string | NumstatEntry[]>; }
export interface Verifier { verify(task: Task, run: string): Promise<Verification>; }
```

## Acceptance
1. On a copy of the fixture, `create` makes `.stint/worktrees/T-0001-r1` on branch `stint/T-0001` at `baseCommit`; a second run after `remove` reuses the branch and keeps the first run's commit: `packages/daemon/test/worktree.test.ts`.
2. A dirty main tree yields `dirty_tree` and a `run.refused` event; a repo with no commits yields `no_commits`: same file.
3. Editing a file in the worktree produces a `file.changed` event within 6 s with the right `added`/`removed`: `packages/daemon/test/worktree.snapshot.test.ts`.
4. `verify` on the fixture writes `verification/r1.json` with `passed: 27, failed: 0, runBy: 'daemon'`; breaking one test yields `failed: 1` and `exitCode: 1`: `packages/daemon/test/verifier.test.ts`.
5. `GET /diff?format=json` equals `git diff --numstat` run by hand: `packages/daemon/test/diff.route.test.ts`.

## Verify
```
bun test packages/daemon
```

## Out of scope
Starting adapters (R-009), the packet (R-012), merge (R-017).

## Notes
Spawn `git` with `Bun.spawn` and explicit `cwd`; never shell out through a string. Use process groups for the test command so a 10-minute cap kills children. The fixture copy helper is `withFixtureRepo()` from SPEC-000.
