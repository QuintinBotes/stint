# When Stint was built

The hackathon's building period starts after the kickoff session on 26 October 2026. Part of this repository was written earlier that same day, before the kickoff. This page says which part, when each later spec was written, and what was built on 28 October, so a judge does not have to work it out from the commit times.

## Before the kickoff (26 October, 15:15 to 17:00 CET)

| Commit | What | Kind |
|---|---|---|
| F-001 | The demo fixture: a small webhook service with 27 tests that the agents work on | preparation the rules allow (the demo target, not Stint) |
| R-001 | Workspace skeleton, bootstrap, identity guard, CI | product scaffolding |
| R-002 | The JSON Schemas as zod, the packet renderer, examples | the contract, which the build kit wrote before the event |
| R-003 to R-007 | Event log and store, daemon and SSE, worktrees and verifier, replay, web UI shell | product code |
| R-008, R-009, R-011 | Terminal backend, Muse Code adapter, cost meter | product code |
| R-012 (first draft) | The packet builder, written before the kickoff and committed after it | product code |
| R-010 | The OpenAI-compatible host client and the fallback chain, written by Muse Code from 16:35 to 18:05 CET, so partly during the kickoff session; committed after it | product code |

Every commit made before the kickoff is listed by `git log --until="2026-10-26 17:00 +0100"`. Commit messages were later edited to drop tool attribution lines. On 27 October the history was rewritten once more to replace a sample email address in one test title and one spec line with plain words, so a publishing check would pass; nothing else in the contents changed. Every author and commit date is unchanged, so the times shown are the real ones.

## After the kickoff (from 17:20 CET on 26 October)

Everything else. The build kit (`AGENTS.md`, `GOAL.md`, `LOOP.md`) and the specs committed before the kickoff (SPEC-000, F-001 and R-001 to R-024) were written before the event as the plan. R-013 was rewritten after the kickoff, when the agent that continues a run became the Stint agent. Every other spec was written during the event: R-025 to R-049 on 26 October, R-050 to R-061 on 27 October, and R-062 to R-064 on 28 October. `git log --diff-filter=A -- specs/` shows when each one was added, and `PROGRESS.md` records what was built from them, when, and by which agent.

## 28 October (from 00:00 CET)

| Commit | What | Kind |
|---|---|---|
| R-060 | Custom skills: write one, import one from a folder, a zip or git, read its pattern scan, approve it onto probation and share it as a zip; the Setup sheet adds and previews them (00:20 to 02:09). fflate 0.8.3 for skill bundles, which fixes a buffer over-read on Zip64 extra fields (18:41) | product code |
| R-061 | Verification and outcome metrics, defined once, with `stint metrics` and Standings on the Factory; the week's spend as one local Monday-to-Sunday figure (00:11 to 15:22) | product code |
| R-007 | The web UI rebuilt in the drawing office design, then simplified into plain words: memory on request, a safer gate, the Factory in four figures and named groups, the Board and Skills (01:02 to 15:42) | product code |
| R-062, R-063, R-064 | The specs for limits you set, how a task went, and sharpening a task or a goal before it starts (18:13) | the plan, written during the event |
| R-062 | Limits you set on builds, hand-offs, review rounds, spend and agent time, with config defaults, meters in the task view, the stop with its two ways on, and `stint limits` (18:25 to 20:13) | product code |
| R-063 | How it went: one outcome record per task, each criterion proven, passing, failing or yours to check, with `stint outcome` and the line above Approve (18:27 to 19:04) | product code |
| R-064 | Sharpen: the few questions that change what gets built, answers kept as decisions, and a proof per criterion; goals above tasks, split into tasks you check first, with limits across them and a rollup of how each went (18:31 to 20:13) | product code |
| R-017, R-034, R-035 | Smaller fixes: approve is refused after a reject or a request for changes, best of n waits for candidates whose autopilot has not started, and Claude Code may run the task's own test command (00:00 to 08:40) | product code |
| R-040, R-003, R-005, R-011, R-013, R-017, R-025 | Fixes from a review of the whole codebase: a token per run, a stricter macOS sandbox, the daemon's git with hooks off, tests in the run's sandbox, restart recovery, a torn event log repaired and parsed logs cached, approve only of a verified commit, every model call's cost counted, secrets kept out of the logs, and the Stint agent's search in a worker (17:25 to 19:12) | product code |
| R-059, R-023 | Two passes over the docs against the code, each page checked against the routes, commands, config and screens (01:08, and again in the evening) | docs |
