# Changelog

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
- **Any agent, any model:** an agent is a config entry. Claude Code and Codex have native adapters. Both are off by default.
- **Smarter hand-offs:**
  - A task escalates after repeated failures.
  - Best of n builds candidates and keeps the best green one.
  - No model reviews its own work.
  - Reviews run per lens: general, security and spec fit.
- **Plans that remember:** the planner reads similar tasks and the decisions on the files it will touch. It splits big tasks into subtasks that run in dependency order.
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
