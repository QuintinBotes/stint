# Changelog

## Unreleased

### Added
- Specs R-050 to R-057 and eleven architecture decision records (`docs/adr/`), from a requirements audit of R-001 to R-049 on 27 October.
- One status button for the daemon, agents and models, with the chat models on this machine that no route uses yet; LM Studio, llama.cpp and LiteLLM as hosts; Claude Code takes its base URL from its host.
- The diff tab on @pierre/diffs with a file tree, viewed marks, per-hunk attribution from git blame and line comments the next agent receives; a windowed timeline with checkpoints that restore a run's code.
- Cards with every state, the review's blockers, the full sign-off record, a permission tier per run and plan steps marked from the packet; the Factory's workspace graph, 7-day funnel, transcript-share figure, benchmark bars and credits left.
- The first live golden eval: 9 of 9 tries passed.
- `bun run dev` is a watch loop for the daemon and the UI; `bun run demo` is the replay.

### Changed
- The Stint agent's refusals check every part of a chain, see through git's global options, and refuse paths outside the worktree and links that lead out of it; grep skips credential files and links.
- Every write under `.stint/` is atomic; `stint otel export` writes beside you.
- Live commands hold off idle sleep on macOS, and the verifier's cap counts awake time only.

### Fixed
- The live golden eval checked its pinned commit out detached, which the daemon refuses.
- Toggles that never showed their state; `[` and `]` losing the file list while events arrived; a replaced terminal dropped from the registry.

## 0.1.0, Meta Global AI Developer Hackathon (26 October to 4 November 2026)

The first release. Everything here was built during the event; `PROGRESS.md` records each spec, who built it and how it was verified.

### The task outlives the agent
- **Workspace:** tasks are folders in `.stint/`. Each has a hash-chained event log, and the daemon is its only writer.
- **Isolated runs:** every run gets its own git worktree, and the daemon runs the tests itself afterwards.
- **The packet:** whenever a run ends, the daemon writes a packet of at most 600 tokens. A killed run gets one too, built from the log alone.
- **Two coding agents on Muse Spark 1.3:** Muse Code, and Stint's own agent with refusals Stint enforces. Hand a task from one to the other at any point.
- **Autopilot:** it plans, builds, verifies and reviews until the approval gate. It hands off when a run fails, stops when two agents in a row make no progress, and can write failing acceptance tests first.
- **Approve:** a real merge with Stint-Task trailers. Reject turns the reason into a decision and the next ask.


### The factory (added on 26 October from the factory review)
- **Verification the agent cannot fake:** the daemon runs a suite of checks. The test files a task names are locked at plan time, and an unexplained change to one fails the run. Held-out scenarios run in a checkout the agent never sees.
- **After merge:** the daemon watches reverts, follow-up work, CI on the base branch and incidents, and links each one to the task that caused it. Approve can open a pull request and follow its checks.
- **Learning that is measured:** a skill starts on probation and earns its place on tasks it helped. A skill that hurts is proposed for retirement. Golden tasks report pass@1 and pass^3.
- **Any agent, any model:** an agent is a config entry. Claude Code and Codex have native adapters, and the Agent Client Protocol adapter covers goose, opencode and Gemini CLI. Every permission request lands in Stint's queue. All are off by default.
- **Smarter hand-offs:**
  - A task escalates after repeated failures.
  - Best of n builds candidates and keeps the best green one.
  - No model reviews its own work.
  - Reviews run per lens: general, security and spec fit.
- **Work from where teams track it:** issues from GitHub and Linear arrive triaged, with size, risk and possible duplicates, and become tasks only when you accept them. Upkeep tasks (doc gardening, dead code and drift) run on a schedule.
- **Plans that remember:** the planner reads similar tasks and the decisions on the files it will touch. It splits big tasks into subtasks that run in dependency order.
- **Risk and the auto-approve lane:** every change gets a risk tier with its reasons. The policy's would-approve is recorded beside every human decision. A lane that merges low-risk changes by policy must be earned on that record, and is off unless you turn it on.
- **Boundaries:** keys stay in the daemon. A default-deny egress proxy, and a sandbox-exec or docker sandbox, run each agent.
- **Seeing the work:**
  - A Files tab with "Open in your editor".
  - A scoreboard per agent and model, with routing learned from it.
  - OpenTelemetry traces.
  - `stint report` for the build record, and `loop.sh --self` so Stint builds Stint.
### Meta models
- **Planning:** Muse Wonder 1.0.
- **Building and continuing:** Muse Spark 1.3.
- **Offline review:** Muse Glimmer 30B through Ollama.
- **Fallback hosts:** Muse Spark Open on Fireworks, Baseten and Modal.
- **Factory view:** shows which model did what, where it ran, and what it cost.

### Memory and learning
- **Memory graph:** projected from the logs, with time travel, similar tasks, files that change together, and the decisions that constrain a task.
- **Decisions are protected:** a review finding that would reverse a decision waits for a person.
- **Learning:** a finding that recurs across tasks becomes a skill proposal with evidence, written only when a person approves it.

### Measuring the packet
- **`stint bench`:** transcript against packet on five live tasks, with the results and charts in the repository.
- **The packet quiz:** facts from the full record, answered from the packet alone.
- **A diff digest** for runs that cannot be asked.
- **Packet sources:** where each part of a packet came from.

### Open to other agents
- Any command-line agent can be added in config (Claude Code and Codex presets ship turned off).
- The Stint agent can run any configured `host/model`.
