# Docs

This folder holds every guide to Stint, one line each, grouped by what you came to do. If you are new to Stint, start with [`setup.md`](setup.md). To check a claim, go to [`proofs.md`](proofs.md).

## Use Stint

- [`setup.md`](setup.md): installing Stint: platforms, what each part needs, where keys load from, your first task and its limits, other agents, the offline review, updating and uninstalling.
- [`agents.md`](agents.md): turning on other agents and models, hosts and keys, running Claude Code, Codex or an ACP agent on a Meta model, and how autopilot hands on, escalates, reviews and stops at a task's limits.
- [`sharpen.md`](sharpen.md): the spec builder, which drafts a task or a goal from a sentence or opens a Spec Kit spec; Sharpen, which asks the questions that change what gets built and records the answers as decisions and proofs; and goals, which split into tasks, run in order and roll up how each task went.
- [`skills.md`](skills.md): custom skills: writing, importing, uploading and exporting, the pattern scan, review and probation, and the `requireReview` gate.
- [`mcp.md`](mcp.md): serving Stint's tools over the Model Context Protocol with `stint mcp`, and registering them with Claude Code or Codex in one line.
- [`otel.md`](otel.md): sending runs to an OpenTelemetry collector or an eval tool.
- [`support.md`](support.md): where to get help: `stint doctor`, troubleshooting, issues and security reports.

## How it works

- [`factory.md`](factory.md): each screen of the web UI, the loop around the hand-off (escalation, best of n, memory, skills, evals and outcomes after merge), and the limits you set on a task or a goal.
- [`packet.md`](packet.md): the `stint.handoff/1` packet: its fields, its rules, runs cut off by a restart, and the killed example as the next agent reads it.
- [`adapters.md`](adapters.md): how an adapter drives one coding agent, the contract, and what each adapter can prove.
- [`verify.md`](verify.md): the verify suite, the tamper guard, held-out scenarios, coverage, visual checks judged by Muse Spark 1.3 and marked by SAM 3.1, and the difference between a proven criterion and one that only passes.
- [`sandbox.md`](sandbox.md): keys and secrets kept out of the logs, the run sandbox and network rules around each worktree, the Stint agent's refusals, each run's own token, risk tiers and the auto-approve lane.
- [`evals.md`](evals.md): skill evals, probation and retirement, the golden tasks and the phase gates.
- [`metrics.md`](metrics.md): verification and outcome metrics, each defined once (first pass, escaped defects, cost per good merge, human load and learning), what each model call costs, and how one task went.
- [`release.md`](release.md): what the daemon records after merge (reverts, follow-ups, CI, incidents) and the pull request release mode.

## Evidence and the hackathon

- [`proofs.md`](proofs.md): every number Stint claims, the live relays, control, learning sequence and scorecard of 29 October on repositories Stint had never seen, the visual gate's live run, the live packet, the benchmark, where each Meta model works, and what was built during the hackathon.
- [`writeup.md`](writeup.md): the submission write-up.
- [`timeline.md`](timeline.md): when Stint was built, which commits came before the hackathon kickoff, when each spec was written, and what was built each day through 31 October.
- [`build-kit.md`](build-kit.md): the spec-driven build loop Stint was built with (`AGENTS.md`, `GOAL.md`, `LOOP.md`, `specs/`).
- [`demo.md`](demo.md): the demo runbook: the commands, the GitHub Pages site (the landing page and the read-only Board), the beats, rehearsal timings, and what to do when a beat goes wrong.
- [`finals.md`](finals.md): the kit for the live judging: the 60-second version, likely questions and fallbacks.
- [`video.md`](video.md): the demo film: how it was made, the cut with its voiceover, and the checklist before recording.
- [`launch.md`](launch.md): the launch post and thread for X.

## Architecture decision records

Each record covers one decision that shapes several specs or departs from one:

- [`adr/README.md`](adr/README.md): how the records are written, and the list of them.
- [`adr/0001-harness-and-host.md`](adr/0001-harness-and-host.md): harness and host are configured separately; Meta models by default.
- [`adr/0002-interfaces-that-moved.md`](adr/0002-interfaces-that-moved.md): the interfaces that changed from their specs during the build.
- [`adr/0003-test-lock-scope.md`](adr/0003-test-lock-scope.md): the plan-time test lock covers the tests the plan and task name.
- [`adr/0004-context-files-for-enabled-agents.md`](adr/0004-context-files-for-enabled-agents.md): other agents' context files are made only when that agent is on.
- [`adr/0005-muse-hooks-as-plugin.md`](adr/0005-muse-hooks-as-plugin.md): Muse Code's hooks ship as a user-scope plugin.
- [`adr/0006-cross-harness-handoffs.md`](adr/0006-cross-harness-handoffs.md): hand-offs and reviews cross harnesses while every model is Meta's.
- [`adr/0007-board-never-loads-a-model.md`](adr/0007-board-never-loads-a-model.md): a task card on the Board (`/`) never makes a local model load.
- [`adr/0008-live-runs-and-sleep.md`](adr/0008-live-runs-and-sleep.md): live runs hold off idle sleep, and caps count awake time.
- [`adr/0009-status-menu.md`](adr/0009-status-menu.md): one status button holds the daemon, agents and models.
- [`adr/0010-muse-login-is-availability.md`](adr/0010-muse-login-is-availability.md): Muse Code is available when its own CLI runs, and Muse's own login does the rest.
- [`adr/0011-default-replay-until-live-take.md`](adr/0011-default-replay-until-live-take.md): the default replay stays hand-written until a network-off live take exists.
