# R-014 · Muse hooks and the AGENTS.md section

Day: 4 (30 Oct) · Owner: CC · Depends on: R-004, R-012 · Fallback: daemon-only drafting on `run.finished` · Cut: never

## Goal
A packet is drafted at the moment context would be lost, not only when a run ends: Muse Code's `PreCompact` and `SubagentStop` hooks post to the daemon, and an agent started outside Stint still finds the active task because `AGENTS.md` carries a Stint section. This is the "Muse Code hooks" line in the Meta-tech write-up and the interop row that costs an hour.

## Context
Muse Code hooks live in `.muse/hooks.json`; the hook events used are `PreCompact` and `SubagentStop`. The readership matrix (which of AGENTS.md, CLAUDE.md, `.cursorrules` each agent reads, with the version verified against) is ported from an earlier terminal project's `readership-matrix.json`; the Muse Code row starts as `unknown` until verified at kickoop and then recorded.

## Requirements
1. MUST ship `packages/adapters/muse-code/hooks/hooks.json.template` with `PreCompact` and `SubagentStop` entries that run `stint hook <event>` (the CLI reads `STINT_TASK`, `STINT_RUN` and `.stint/cache/daemon.json`, posts `{ event, sessionId, cwd }` to `POST /api/tasks/:id/handoff { enrich: false, reason: 'precompact' | 'subagentstop' }`) with a 5 s timeout; the daemon writes the hook file into the worktree's `.muse/` at assign time (never into the main tree) and removes it with the worktree.
2. MUST make `stint hook` exit 0 and print nothing on success, print one stderr line and exit 0 on failure (`Stint hook: could not reach the daemon at <addr>. The packet was NOT drafted.`): the hook must never block Muse Code.
3. MUST implement `stint init` (R-001 created the folder; this spec writes the files): `.stint/config.json` defaults, `.gitignore` entries, and a `## Stint` section appended to `AGENTS.md` (created if missing) that states where tasks live, how to read a packet (`stint packet <task> --as prompt`), the active task pointer (`.stint/active` written by assign), and the rule that an agent must write its decisions as `decision:` lines in its messages so the daemon can record them.
4. MUST implement the readership matrix at `packages/core/src/readership.json` with `verifiedAgainst` versions and expose it on `/api/health` per adapter, so the UI can say "reads AGENTS.md (verified against muse 1.4.x)" or "unknown".
5. MUST record a `decision.recorded` event when an agent message contains a line matching `^decision: (.+)$` (and `supersedes: D<n>` on the next line), appending to `decisions.md` with the run as provenance; this is how D3 lands on camera.
6. SHOULD write `.stint/active` (`{ task, run, worktree }`) on assign and clear it on `run.finished`.

## Interfaces
- `stint hook <PreCompact|SubagentStop>`; `stint init [--force]`.
- `AGENTS.md` section delimited by `<!-- stint:start -->` and `<!-- stint:end -->` so `init` can refresh it without touching the rest.

## Acceptance
1. `stint init` on the fixture copy writes `.stint/config.json`, the gitignore entries and the delimited section; running it twice changes nothing: `packages/cli/test/init.test.ts`.
2. A live Muse Code run with the hook template installed produces a `handoff.created { reason: 'precompact' }` event when compaction is forced (`STINT_LIVE=1`); the replay twin posts the hook payload by hand and asserts the same: `packages/daemon/test/hooks.test.ts`.
3. With the daemon stopped, `stint hook PreCompact` exits 0 and prints the NOT-drafted line to stderr: `packages/cli/test/hook.test.ts`.
4. An `agent.message` containing `decision: Sliding window over fixed window` appends `D<n>` to `decisions.md` and emits `decision.recorded`: `packages/daemon/test/decision.capture.test.ts`.
5. `/api/health` shows `reads: ['AGENTS.md', '.agents/skills']` for muse-code with `verifiedAgainst`: `packages/daemon/test/health.test.ts`.

## Verify
```
bun test packages/cli packages/daemon
```

## Out of scope
Claude SDK hooks (optional), the learn step.

## Notes
The hook file goes in the worktree so the main tree is never modified by a run. Verify the exact hook event names against the installed Muse Code at kickoff and record them in a Decision; if `PreCompact` is not available, use `Stop` and say so in the write-up. The `decision:` convention is also added to the system framing in `renderPrompt` so agents know to use it.
