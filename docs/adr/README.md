# Architecture decision records

This folder is for anyone who wants the reasoning behind Stint's design: one file per decision that shapes more than one spec, or that departs from a spec line. Each has a status, the context, the decision and what follows from it. The short form of each lives in `PROGRESS.md` (Decisions and Deviations); these files carry the reasoning.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-harness-and-host.md) | Harness and host are configured separately; Meta models by default, every other agent and model opt in | Accepted |
| [0002](0002-interfaces-that-moved.md) | The interfaces that changed from their specs during the build | Accepted |
| [0003](0003-test-lock-scope.md) | The plan-time test lock covers the tests the plan and task name | Accepted |
| [0004](0004-context-files-for-enabled-agents.md) | Other agents' context files are made only when that agent is on | Accepted |
| [0005](0005-muse-hooks-as-plugin.md) | Muse Code's hooks ship as a user-scope plugin, not per-worktree files | Accepted |
| [0006](0006-cross-harness-handoffs.md) | Hand-offs and reviews cross harnesses while every model is Meta's | Accepted |
| [0007](0007-board-never-loads-a-model.md) | A task card on Timing (`/`) never makes a local model load | Accepted |
| [0008](0008-live-runs-and-sleep.md) | Live runs hold off idle sleep; caps count awake time | Accepted |
| [0009](0009-status-menu.md) | One status button holds the daemon, agents and models | Accepted |
| [0010](0010-muse-login-is-availability.md) | Muse Code is available when its CLI runs, and Muse's own login does the rest | Accepted |
| [0011](0011-default-replay-until-live-take.md) | The default replay stays hand-written until a network-off live take exists | Accepted, owner to close |
