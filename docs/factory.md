# The factory

What the UI shows, and the loop Stint runs around every hand-off. Each part has its own page in this folder.

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


<p align="center"><img alt="The Factory: the week in figures, the relay of runs across Meta's models with the 412-token packet and the learned skill, and the memory graph of the whole workspace" src="../assets/screenshot-factory.png" width="900"></p>

## The loop around the hand-off

Beyond the hand-off, Stint runs the loop around it. Each part has its own page in `docs/`:

- **Verification an agent cannot fake.** The daemon runs the tests and the configured checks. The test files a task names are locked at plan time, so an agent that weakens them fails. Held-out scenarios run in a checkout the agent never sees ([`verify.md`](verify.md)).
- **Hand-offs that get smarter.**
  - A task escalates after repeated failures.
  - Best of n builds candidates in parallel and keeps the best green one.
  - No model reviews its own work.
  - Reviews run per lens: general, security and spec fit ([`agents.md`](agents.md)).
- **Plans that remember.** The planner reads similar tasks and the decisions on the files it will touch. It splits big tasks into subtasks that run in dependency order.
- **Learning that is measured.** A learned skill starts on probation, carries an eval with and without it, and is proposed for retirement if it hurts. Golden tasks report pass@1 and pass^3 ([`evals.md`](evals.md)).
- **After merge.** Reverts, follow-up work, failing CI and incidents are linked to the task that caused them. Approve can open a pull request and follow its checks ([`release.md`](release.md)).
- **Boundaries.**
  - Keys stay in the daemon.
  - A default-deny egress proxy, and a sandbox-exec or docker sandbox per run.
  - Risk tiers on every change.
  - An auto-approve lane that is off and must be earned on a shadow record ([`sandbox.md`](sandbox.md)).
- **Work from where teams track it.** Issues from GitHub and Linear arrive triaged. Doc gardening and drift tasks run on a schedule.
- **Any harness, any model.**
  - Muse Code and Stint's agent by default.
  - Claude Code, Codex, and any Agent Client Protocol agent (goose, opencode, Gemini CLI) as off-by-default config entries.
  - A scoreboard that can route by results, and OpenTelemetry traces for any eval tool ([`otel.md`](otel.md)).
- **Stint builds Stint.** `scripts/loop.sh --self` turns the next spec into a Stint task that stops at your approval, and `stint report` writes the build record from `.stint/`.

## Stint as a tool for any agent

`stint mcp` serves Stint over MCP: the board, packets, similar tasks, the decisions that constrain a file, recording a decision, handing off, autopilot and verify. The Stint plugin registers it for Muse Code, so Muse Code can read the memory mid-session. Any other MCP client can connect too. Approving and merging stay with a person. See [`mcp.md`](mcp.md).
