# ADR-0005: Muse Code's hooks ship as a user-scope plugin, not per-worktree files

Status: Accepted, 27 Oct 2026. Spec: R-014 Req 1.

## Context
R-014 writes a `hooks.json` template into each run's worktree under `.muse/` at assign, posting `{event, sessionId, cwd}`. Muse Code 1.4 loads hooks from approved plugins at user scope, and a file written into the worktree would appear in the task's diff and the merge.

## Decision
Stint ships a Muse plugin (`packages/adapters/muse-code/plugin`) that the person installs and approves once; `stint init` prints the two commands. Its PreCompact, SubagentStop and PreToolUse hooks post `{run, reason}` to the daemon, which knows the task from the active run.

## Consequences
- Worktrees and merges never carry Stint's hook files.
- The live forced-compaction proof needs the plugin installed in the person's Muse config, so it is an owner step (R-057); the replay twin covers the path in CI.
