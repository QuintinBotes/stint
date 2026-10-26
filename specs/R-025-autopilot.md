# R-025 · Autopilot: the factory runs itself to the gate

Day: 7 (2 Nov) · Owner: Q · Depends on: R-010, R-012, R-013, R-017 · Fallback: a manual "Hand to" with the recommended agent preselected · Cut order: 5

## Goal
A task drives itself through plan, build, verify and review, and stops only at the approval gate. When a run ends killed, capped, failed or red, the daemon hands its packet to the next agent in the implementer chain without anyone asking, so the kill beat's recovery happens on its own: "the task outlives the agent" without a human in the loop. Several tasks can be on autopilot at once, each in its own worktree, bounded by budgets and host rate limits. This is what turns the board into a factory floor.

## Context
Every piece exists: the planner chain (R-010), assign and stop (R-009), the packet on every ending (R-012), the Stint agent (R-013), review with the contradiction gate (R-010), approve (R-017). Autopilot is the policy that sequences them. The person stays the only one who merges.

## Requirements
1. MUST add an autopilot switch per task, recorded in the log as `autopilot.started` and `autopilot.stopped` (no new field in `task.json`), with defaults under `autopilot` in `.stint/config.json`, the route `POST /api/tasks/:id/autopilot { on: boolean }`, and `stint run <task> [--auto]`.
2. MUST sequence: plan (if there is no plan) with the planner chain; build with the first available implementer in `config.autopilot.implementers` (default `['muse-code', 'stint-agent']`); verify; review with the reviewer chain; on `approve` stop at `awaiting_approval`; on `request_changes` hand the findings back to the implementer as the ask, once; on `block` stop at `building` with the blockers as the pending ask.
3. MUST hand off on its own: a run that ends `killed`, `capped`, `failed`, or `completed` with a red verification is followed by `hand` to the next implementer in the chain (wrapping to the first), with the packet the ending built, at most `config.autopilot.maxHops` (default 3) times before stopping with "Needs you" and the reason.
4. MUST respect every existing guard: budgets per role, `run_active`, `adapter_unavailable` (skip to the next agent), the dirty-tree refusal, and the approval gate (autopilot never approves).
5. MUST run up to `config.autopilot.parallel` (default 2) tasks at once, queued in board order; a task waiting for a slot shows "queued".
6. MUST make every autopilot decision visible: each step emits `autopilot.step { step, reason }`, and the event schema gains `autopilot.started`, `autopilot.step` and `autopilot.stopped` (R-025 owns that schema change).
7. SHOULD show an "Autopilot" switch on the task header and an "autopilot" chip on board cards, with the current step.

## Interfaces
- `POST /api/tasks/:id/autopilot { on }` → `{ on, step }`; `GET /api/health.autopilot` → `{ running: [...], queued: [...] }`.
- Event types `autopilot.started`, `autopilot.step { step: 'plan'|'build'|'verify'|'review'|'hand'|'wait', reason }`, `autopilot.stopped { reason }`.

## Acceptance
1. With fake adapters, a task on autopilot goes planned to awaiting_approval with events plan, build, verify, review in order and no approval: `packages/daemon/test/autopilot.test.ts`.
2. A fake implementer that ends `killed` is followed by a `hand` to the next implementer from the packet the kill built; the second run's `run.started.handoffFrom` names that packet: same file.
3. Three red hops stop autopilot with "Needs you" and the reason: same file.
4. Two tasks on autopilot with `parallel: 1` run one after the other, the second shown queued: same file.

## Verify
```
bun test packages/daemon
```

## Out of scope
Approving or merging on its own, scheduling across machines, cost-based routing beyond the chains.

## Notes
Keep it a small state machine over events: the next step is a pure function of the task's log and config, so a daemon restart resumes autopilot from the log.
