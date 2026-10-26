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
