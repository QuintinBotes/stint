# Docs

Every guide in this folder, one line each, grouped by what you came to do. New to Stint? Start with [`setup.md`](setup.md). To check a claim, go to [`proofs.md`](proofs.md).

## Use Stint

- [`setup.md`](setup.md): the full setup guide: platforms, install, where keys load from, other agents, the offline review, updating and uninstalling.
- [`agents.md`](agents.md): turning agents and models on, hosts and keys, and running Claude Code, Codex or an ACP agent on a Meta model.
- [`sharpen.md`](sharpen.md): sharpening a task before it starts: the questions Stint asks and drops, what is always asked, answers as decisions, proofs, the CLI and the config.
- [`skills.md`](skills.md): custom skills: write, import, upload, export, the pattern scan, review and probation, and the requireReview gate.
- [`mcp.md`](mcp.md): serving Stint's tools over the Model Context Protocol with `stint mcp`.
- [`otel.md`](otel.md): sending runs to an OpenTelemetry collector or an eval tool.
- [`support.md`](support.md): where to get help: `stint doctor`, troubleshooting, issues and security reports.

## How it works

- [`factory.md`](factory.md): each screen of the web UI, and the factory around the hand-off: escalation, best of n, memory, skills, evals and outcomes after merge.
- [`packet.md`](packet.md): the `stint.handoff/1` packet: its fields, its rules, and the killed example as the next agent reads it.
- [`adapters.md`](adapters.md): how an adapter drives one coding agent, the contract, and what each adapter can prove.
- [`verify.md`](verify.md): the verify suite, the tamper guard, held-out scenarios and coverage.
- [`sandbox.md`](sandbox.md): keys, the run sandbox and network rules around each worktree, risk tiers and the auto-approve lane.
- [`evals.md`](evals.md): skill evals, probation and retirement, the golden tasks and the phase gates.
- [`metrics.md`](metrics.md): verification and outcome metrics, defined once: first pass, escaped defects, cost per good merge, human load and learning.
- [`release.md`](release.md): what the daemon records after merge (reverts, follow-ups, CI, incidents) and the pull request release mode.

## Evidence and the hackathon

- [`proofs.md`](proofs.md): every number Stint claims, the live packet, the benchmark, where each Meta model works, and what was built during the hackathon.
- [`writeup.md`](writeup.md): the submission write-up.
- [`timeline.md`](timeline.md): when Stint was built, and which commits came before the hackathon kickoff.
- [`build-kit.md`](build-kit.md): the spec-driven build loop Stint was built with (`AGENTS.md`, `GOAL.md`, `LOOP.md`, `specs/`).
- [`demo.md`](demo.md): the demo runbook: the commands, the beats, rehearsal timings and what to do when a beat goes wrong.
- [`finals.md`](finals.md): the kit for the live judging: the 60-second version, likely questions and fallbacks.
- [`video.md`](video.md): the demo video's script, timings and the footage capture.
- [`launch.md`](launch.md): the launch post and thread for X.

## Architecture decision records

One record per decision that shapes several specs or departs from one:

- [`adr/README.md`](adr/README.md): how the records are written and the list of them.
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
