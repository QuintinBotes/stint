# When Stint was built

The hackathon's building period starts after the kickoff session on 26 October 2026. Part of this repository was written earlier that same day, before the kickoff, and this page says which part, so a judge does not have to work it out from the commit times.

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

Everything else. The specs in `specs/` and the build kit (`AGENTS.md`, `GOAL.md`, `LOOP.md`) were written before the event as the plan; `PROGRESS.md` records what was built from them, when, and by which agent.
