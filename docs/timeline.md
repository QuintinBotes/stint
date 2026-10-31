# When Stint was built

This page shows judges what was built during the hackathon, day by day, so they need not work it out from the commit times. The building period starts after the kickoff session on 26 October 2026; part of this repository was written earlier that day, and the first section lists that part. Times are CET, from each commit's author date.

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

`git log --until="2026-10-26 17:00 +0100"` lists every commit made before the kickoff. Commit messages were later edited to drop tool attribution lines. On 27 October the history was rewritten once more to replace a sample email address in one test title and one spec line with plain words, so a publishing check would pass; nothing else in the contents changed. Every author and commit date is unchanged, so the times shown are the real ones.

## Which specs came before the event

The build kit (`AGENTS.md`, `GOAL.md`, `LOOP.md`) and the specs committed before the kickoff (SPEC-000, F-001 and R-001 to R-024) were written before the event as the plan. R-013 was rewritten after the kickoff, when the agent that continues a run became the Stint agent. Every other spec was written during the event: R-025 to R-049 on 26 October, R-050 to R-061 on 27 October, R-062 to R-064 on 28 October, R-065 to R-070 on 29 October, and R-073 and R-074 on 30 October. R-028, R-071 and R-072 have rows in `PROGRESS.md` but no spec file. `git log --diff-filter=A -- specs/` shows when each spec was added, and `PROGRESS.md` records what was built from each, when, and by which agent.

## 26 October, after the kickoff (from 17:20 CET)

| Commit | What | Kind |
|---|---|---|
| R-010, R-012, R-013 | The fallback chain committed, the packet builder finished, and the Stint agent that continues a run (17:28 to 19:57) | product code |
| R-014 to R-020, R-025 to R-028 | Muse Code's hooks, the timeline and diff, cards and the gate, approve with trailers, the memory graph and its clock, the learn step and skills, autopilot to the gate, any CLI agent, tests first, and Stint over MCP (17:52 to 21:42) | product code |
| R-021 to R-023 | `stint bench`, demo seeding and the first live recording, the write-up, the video script and the docs (18:41 to 20:15) | product code and docs |
| R-030 to R-048 | The factory: outcomes after merge, skill evals, the agent registry, Claude Code and Codex adapters, escalation and best of n, a planner that reads the memory, review lenses, risk tiers, the sandbox and egress proxy, release through pull requests, OpenTelemetry, the scoreboard, golden tasks, Stint building Stint, and shared context (22:06 to 23:36) | product code |

## 27 October

| Commit | What | Kind |
|---|---|---|
| R-029, R-033, R-037, R-039, R-041, R-044 | The verify suite and tamper guard, the Agent Client Protocol adapter, held-out scenarios and coverage, risk tiers, intake from GitHub and Linear, and scheduled upkeep (00:11 to 00:50) | product code |
| R-049, R-046 | The demo says what the factory does; golden tasks with pass^k (00:58 to 09:18) | product code |
| R-050 to R-056 | From a requirements audit of R-001 to R-049: every agent and model in view, complete cards and gate, memory and the Factory, boundaries an agent cannot cross, routing and cost, the learn step and the bench, and the demo runner and dev loop (10:19 to 17:36) | product code |
| R-057 | Live proofs: the bench on the current build, the golden set and the skill eval, on Meta's models (12:30 to 17:15) | product code and live runs |
| R-058, R-059 | A guard that keeps client and employer names out, in CI; a README and a setup guide a stranger can follow (17:45 to 23:31) | product code and docs |

## 28 October

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

## 29 October

| Commit | What | Kind |
|---|---|---|
| R-010 | The Baseten host asks for the one model id the hackathon key accepts (08:31) | product code |
| R-065 | The charcoal redesign: near-black tokens, a shape beside every status word, a compact top bar, a Board of four groups, quiet tables, dialogs with a visible Close and draft protection, and a task page that gives the one next action and holds every action while looking back (08:46 to 11:50) | product code |
| R-067, R-068, R-069, R-070 | The specs for a light theme, the visual gate, the judge path and live evidence (08:59 and 09:56) | the plan, written during the event |
| R-066 | The spec builder: a sentence drafted into a spec in GitHub Spec Kit's shape, with only the questions that matter; open, export and create, in the daemon, the CLI and one dialog (09:26 to 10:35) | product code |
| R-064, R-017, R-020 | Goals that run and finish: proofs reach the tasks, `stint goal run`, `limits` and `abandon`; sending work back starts autopilot again or sets the task rejected; approve waits while a finding that would reverse a decision is queued (10:16 to 11:13) | product code |
| R-005, R-028, R-037, R-040, R-053 and others | Fixes from a spec audit: a command that cannot start comes back red, the Stint agent's refusals read through quotes, a stricter macOS sandbox, only the tools a run token can call inside a run, scenarios that cannot run turn verification red, every model call metered, and tests added for older specs (10:07 to 10:47) | product code |
| R-069 | The judge path: a read-only board for GitHub Pages and its workflow, `stint mcp install`, bootstrap that downloads Glimmer only when asked, Claude Code and Codex on in the replay, and a command for every gate and board action (10:16 to 11:50) | product code |
| R-068 | The visual gate: the daemon opens the page, Muse Spark 1.3 judges the screenshot, SAM 3.1 marks what looks wrong, and one live check is kept in `bench/visual/` (12:42 to 13:11) | product code and a live run |
| R-071 | The adversarial UX audit, `UX_AUDIT.md`: what needs you and why, Run all asks first, permission questions in Needs you, the gate lists contradictions, a task shows its goal (12:44 to 13:01); Run the goal's tasks asks first too (16:38) | product code |
| R-067 | The light theme, chosen by the system setting and measured on every main screen (12:51) | product code |
| R-059, R-069 | The README's For judges section, screenshots in both themes, and every docs page checked against the code (afternoon) | docs |
| R-072 | Defects from an exploratory end-to-end test and a UI spec audit: a run assigned or handed on by hand goes on to review and the gate, busy buttons keep focus, and focus lands near a control that left the page (14:23 to 15:23) | product code |
| R-070 | Live evidence: the relay runner with seeded tasks and held-out scenarios (13:27); live relays on jshttp/negotiator, jeffbski/wait-on and vercel/ms, the control and the learning sequence (15:09 to 17:02); the scorecard runner (16:42) and the live scorecard (19:18); the proofs page led by this evidence (19:43); the scorecard on the Factory (20:00) | product code and live runs |
| R-013 | The Stint agent asks again with more room when a reasoning model's reply is cut off, the defect the first live scorecard found; that run is kept in `bench/scorecard-1` (18:12) | product code and a live run |
| R-068, R-066 | The spec builder may propose a visual proof (20:16), and drafts against real models on its own route, led by Muse Spark 1.3 (21:14) | product code |

## 30 October

| Commit | What | Kind |
|---|---|---|
| R-016, R-019, R-021, R-064, R-066 | Smaller fixes: the gate offers no decision before anything is built, the runs chart puts each run in the lane of whoever finished it and names every harness, the bench chart's label no longer overlaps its legend, a drafted task keeps its requirements as lines, and a merged or abandoned task asks no more Sharpen questions (14:56 to 19:05) | product code |
| R-066, R-023 | The docs say the spec builder drafts on Muse Spark 1.3; the video script follows the cut of 30 October (15:16) | docs |
| R-073, R-074 | The specs for the terminal story and for money shown only at a spend limit (18:29 and 23:27) | the plan, written during the event |
| R-073 | The terminal tells the whole story: `stint watch` follows a task live, `stint stop` stops its run, `stint review` reviews the verified change, and `stint up --no-review` leaves review to the person (18:29); a harness drives a whole goal through Stint over MCP with `stint_new_goal`, `stint_plan_goal` and `stint_run_goal` (20:28); `stint watch` with no task follows every task (23:27) | product code |
| R-074 | The UI shows money only where a person sets or meets a spend limit (23:27) | product code |

## 31 October

| Commit | What | Kind |
|---|---|---|
| R-010 | A host sets its own `timeoutMs`, and Ollama's is 10 minutes, so Glimmer can finish a review of a large diff (07:42) | product code |
| R-062 | `stint limits <task> --implementer-tokens N` raises a task's token budget, a refused run names that command, and the default implementer budget is 1,200,000 tokens (08:52) | product code |
| R-017 | A refused approval reads as words at the gate: a merge conflict names its files (09:35) | product code |
| R-024 | The video page's final cut, the changelog and the README's case for judges (10:23 to 10:59); the film published (11:36); the submission, sent through the Cerebral Valley form at 11:35 CET and recorded at 11:47 | docs and submission |
| R-068 | The owner's decision that the visual check keeps drawing SAM 3.1's box, with no `@meta-sam/parser` dependency (D-095, 11:10) | decision |
