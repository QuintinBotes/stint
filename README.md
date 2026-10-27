<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
    <img alt="Stint" src="assets/logo-light.png" width="200">
  </picture>
</p>

<h3 align="center">The task outlives the agent.</h3>

<p align="center">A local software factory on Meta's Muse models. Kill an agent mid-task and another one finishes it from a packet of a few hundred tokens. The daemon, not the agent, says whether the tests pass, and only you merge.</p>

<p align="center"><img alt="The T-0042 task view: four runs on the left, the diff in the middle, the memory graph and a decision waiting for you on the right" src="assets/screenshot-task.png" width="900"></p>

## Why

Coding agents are good at a task until the session ends: the context fills up, the process dies, the rate limit hits, or you want a different agent for the next step. Then the work lives in a transcript that nobody can hand on, and a person reruns everything. Stint makes the task, not the chat, the unit of work. The task is a folder in your repository, and any agent can pick it up. When a run ends, however it ends, Stint writes a packet the next agent continues from. Every run gets its own git worktree, and the daemon runs the tests itself. A local model reviews, and the person merges.

## Three proofs

| Claim | What happens | Evidence |
|---|---|---|
| A killed agent's work survives | Muse Code builds T-0042 on Muse Spark 1.3 and is killed mid-run. The daemon builds the packet from the log and the diff alone, and names the step that was in flight as unknown. Stint's own agent, also on Muse Spark 1.3, continues from the packet. | Live, 26 October: the continued run finished, and the daemon's own `bun run test` passed 29 of 29 for $0.10 (120,218 input tokens, 76,093 of them cached). The recorded replay's packet is 412 tokens. Test: `packages/daemon/test/continue.live.test.ts`; its replay twin runs in CI. |
| Review costs nothing and needs no network | Muse Glimmer 30B reviews on the laptop through Ollama. A finding that would reverse a recorded decision is not applied. It waits in a queue until a person keeps or supersedes the decision. | `review.recorded { offline: true }` at $0.00. Test: `packages/daemon/test/review.contradiction.test.ts` |
| It learns | When the same finding shows up on two tasks, the learn step proposes a skill with that evidence. Nothing is written until a person approves it, and the next task runs with it. | T-0040 and T-0042 share the hard-coded limit finding. That raised `limiter-config-via-env`, and T-0043 applied it and got no review finding on that point. Test: `packages/daemon/test/learn.test.ts` |

## Quick start (no keys needed)

```
git clone https://github.com/QuintinBotes/stint && cd stint
scripts/bootstrap.sh
bun run dev
```

`bun run dev` replays the recorded story through the real daemon and opens the UI at `http://127.0.0.1:<port>`: a real event log and hash chain, real git commits and a real merge. The UI says it is a replay. Chrome can install it as an app in its own window.

`stint demo --live` runs the same story for real with your keys, beat by beat: Muse Wonder plans, Muse Code builds and is killed, the Stint agent continues, Glimmer reviews offline, you approve, and the factory learns. `stint demo record` turns that run into a recording anyone can replay.

To run it on your own repository with your own keys:

```
cp .env.example .env            # META_API_KEY, and optionally FIREWORKS_API_KEY, BASETEN_API_KEY, MODAL_*
ollama pull muse-glimmer:30b-mlx
alias stint="bun $PWD/packages/cli/bin/stint"
cd /path/to/your/repo
stint init
stint up &
stint new "Rate-limit incoming webhooks" --accept "429 with Retry-After; other tenants unaffected"
stint run T-0001                # autopilot: plan, build, verify, review, then it waits for you
stint approve T-0001            # a real merge, with Stint-Task trailers
```

## What you see

- **Board**: every task by stage, each card showing the agents that worked on it and who holds it now. Issues pulled from GitHub or Linear wait in an intake panel until you accept them. Run all puts every planned task on autopilot.
- **Task view**: the task, its acceptance criteria and its spend across the top. The runs are on the left, one agent after another with every hand-off. In the middle:
  - the diff, and the worktree's files with "Open in your editor";
  - a terminal in the worktree;
  - the plan and the packet;
  - the review, one row per lens;
  - the daemon's verification: "33 passed, tests unchanged".

  The memory panel on the right shows similar tasks, the decisions that constrain this one, and a scrubber that goes back in time. The approval gate opens only on a green verification, and shows the change's risk tier.
- **Factory**: who carried each task and what they handed on, which Muse model did what and what it cost. Also there:
  - a scoreboard per agent and model;
  - outcomes after merge (reverts, follow-ups, failing CI);
  - the auto-approve lane's shadow record;
  - scheduled upkeep;
  - every harness and host this workspace can use.
- **Skills**: what the agents load before a run, learned or written by hand, with evidence, an eval with and without, and a track record.

<p align="center"><img alt="The Factory: Meta models at work, with tokens, cache share and cost per model" src="assets/screenshot-factory.png" width="900"></p>

## The packet

`stint.handoff/1` is a published JSON Schema (`packages/core/schemas/handoff.schema.json`). It holds:

- **Where it got to:** what is done, what is open and what the leaving agent left out.
- **What the gate refused.**
- **The decisions in force.**
- **The changed files and the daemon's verification.**
- **One `askOfNext`.**

It always renders under 600 tokens, and a killed run gets one too. The recorded killed packet, as the next agent reads it, is in [`docs/packet.md`](docs/packet.md).

## Benchmark

`stint bench` runs the same tasks twice from the same commit. Each time Muse Code is capped at the same step, and the Stint agent continues on Muse Spark 1.3, once from the full transcript and once from the packet plus the diff. The daemon runs the tests both times.

Live, 26 October, five tasks:

| Continue from | Hand-over prompt | Input tokens for the whole continued run | Cost | Tests green (daemon) |
|---|---|---|---|---|
| the transcript | 4,418 tokens | 60,816 | $0.059 | 5 of 5 |
| the packet | 728 tokens | 64,863 | $0.065 | 5 of 5 |
| the packet with the diff digest | 797 tokens | 48,623 | $0.054 | 5 of 5 |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="bench/results.svg">
  <img alt="Input tokens per continued run, transcript against packet, for five tasks" src="bench/results-light.svg" width="640">
</picture>

The first packet was six times smaller to hand over, and every continued run passed. But the whole run cost about the same as starting from the transcript. These first runs were short (7 or 8 steps), and the agent that started from the packet spent the difference re-reading code. The packet quiz showed why: the packet said which files changed, not what the code now does. So a run that cannot be asked now gets a digest of what its diff implements. On a second live run of the packet side, the continued runs used 25% fewer input tokens. That made the packet 1.25 times cheaper than the transcript overall, still with 5 of 5 green.

One run per task is a small sample, and single tasks swung both ways, so read this as a first measurement, not a law. The digest also failed to arrive for one task. The rows, prompts, packets and transcripts are in `bench/runs/` and `bench/digest/runs/`, and `stint bench --replay` rebuilds the tables from them.

## The factory

Beyond the hand-off, Stint runs the loop around it. Each part has its own page in `docs/`:

- **Verification an agent cannot fake.** The daemon runs the tests and the configured checks. The test files a task names are locked at plan time, so an agent that weakens them fails. Held-out scenarios run in a checkout the agent never sees ([`docs/verify.md`](docs/verify.md)).
- **Hand-offs that get smarter.**
  - A task escalates after repeated failures.
  - Best of n builds candidates in parallel and keeps the best green one.
  - No model reviews its own work.
  - Reviews run per lens: general, security and spec fit ([`docs/agents.md`](docs/agents.md)).
- **Plans that remember.** The planner reads similar tasks and the decisions on the files it will touch. It splits big tasks into subtasks that run in dependency order.
- **Learning that is measured.** A learned skill starts on probation, carries an eval with and without it, and is proposed for retirement if it hurts. Golden tasks report pass@1 and pass^3 ([`docs/evals.md`](docs/evals.md)).
- **After merge.** Reverts, follow-up work, failing CI and incidents are linked to the task that caused them. Approve can open a pull request and follow its checks ([`docs/release.md`](docs/release.md)).
- **Boundaries.**
  - Keys stay in the daemon.
  - A default-deny egress proxy, and a sandbox-exec or docker sandbox per run.
  - Risk tiers on every change.
  - An auto-approve lane that is off and must be earned on a shadow record ([`docs/sandbox.md`](docs/sandbox.md)).
- **Work from where teams track it.** Issues from GitHub and Linear arrive triaged. Doc gardening and drift tasks run on a schedule.
- **Any harness, any model.**
  - Muse Code and Stint's agent by default.
  - Claude Code, Codex, and any Agent Client Protocol agent (goose, opencode, Gemini CLI) as off-by-default config entries.
  - A scoreboard that can route by results, and OpenTelemetry traces for any eval tool ([`docs/otel.md`](docs/otel.md)).
- **Stint builds Stint.** `scripts/loop.sh --self` turns the next spec into a Stint task that stops at your approval, and `stint report` writes the build record from `.stint/`.

## Stint as a tool for any agent

`stint mcp` serves Stint over MCP: the board, packets, similar tasks, the decisions that constrain a file, recording a decision, handing off, autopilot and verify. The Stint plugin registers it for Muse Code, so Muse Code can read the memory mid-session. Any other MCP client can connect too. Approving and merging stay with a person. See [`docs/mcp.md`](docs/mcp.md).

## Meta models, where each one works

| Model | Where it runs | What it does in Stint |
|---|---|---|
| Muse Wonder 1.0 | Meta Model API | plans each task with structured output |
| Muse Spark 1.3 | Meta Model API, through Muse Code | builds in the task's worktree; Muse Code's JSON event stream becomes the timeline |
| Muse Spark 1.3 | Meta Model API, through the Stint agent | continues from a packet: Stint's own tool-calling agent, with refusals Stint enforces |
| Muse Glimmer 30B | Ollama on your machine | reviews at $0.00 with the network off |
| Muse Spark Open | Fireworks, Baseten, Modal | fallback for planning, building and the learn step when the Meta API is busy |
| Muse Code plugin hooks | your machine | draft a packet at the moment context would be lost, and name the step in flight |

Every model Stint calls at runtime by default is a Meta model, and the demo uses nothing else. Stint stays vendor-neutral, because that is what the packet is for. You can add another coding agent or model in config, such as Claude Code, Codex or any Ollama model; those ship turned off ([`docs/agents.md`](docs/agents.md)).

## How it is built

A Bun and TypeScript monorepo:

- **The daemon (Hono)** is the only writer of `.stint/`.
- **A hash-chained event log** is the source every view is projected from, including the memory graph and the cost meter.
- **Adapters** never touch the store.
- **A React UI** is served by the daemon on 127.0.0.1 with a per-session token.

Over 300 tests run in CI. Playwright adds a suite against the replay, end-to-end flows driven through the browser against a live daemon with fake agents, and an accessibility check of every main screen against WCAG 2.2 AA. `PROGRESS.md` records every spec, which agent built it and how it was verified.

## Built during the hackathon

Everything in this repository was built from 26 October 2026 onward, for the Meta Global AI Developer Hackathon. [`docs/timeline.md`](docs/timeline.md) lists the part committed on 26 October before the kickoff session. The specs in `specs/` and the build kit (`AGENTS.md`, `GOAL.md`, `LOOP.md`) are the plan, written before the event; [`docs/build-kit.md`](docs/build-kit.md) says what they are. Parts of the code were written by Muse Code on Muse Wonder Full from a brief. Those commits carry a `Model:` trailer, and `PROGRESS.md` names them.

## Ideas borrowed

Stint's stuck detection, its packet quiz, the packet's source list and tests first re-implement ideas from earlier work on agent factories. No code was taken.

## Support

macOS and Linux. Windows through WSL is untested. Bun 1.3.14 or later and git 2.40 or later; Ollama for the offline review. See [`docs/support.md`](docs/support.md).

## Roadmap

- Fine-tune Muse Spark Open on approved packets and skills; Fireworks offers it as a base model.
- Run the factory across machines: the event log is already the only source of truth.
- Container images per agent for the docker sandbox, so turning one on is one line.

## Licence

MIT. See [`LICENSE`](LICENSE).

Built with Muse Spark Open.
