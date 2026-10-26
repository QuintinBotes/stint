# R-045 · A scoreboard and learned routing

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-030, R-031

## Goal
Every run already carries adapter, model, host, cost and the verify result, so which agent to use per task type is a projection, then a learned choice.

## Requirements
1. MUST project a scoreboard per tag and per agent and model: runs, pass rate, pass^3 (all three of the last three attempts green), cost per resolved task, reverts; `GET /api/scoreboard`; a Factory panel.
2. MUST implement `routing.mode: 'learned'`: when autopilot picks an implementer, sample from a Beta posterior of each eligible agent's pass rate for the task's tags (Thompson sampling), with `routing.explore` as the floor for agents with few runs, seeded from `stint eval` results; record `routing.chosen { agent, tags, score, explored }`; `chains` mode keeps today's order.

## Acceptance
1. The scoreboard computes pass rate and cost per resolved task from runs: `packages/core/test/scoreboard.test.ts`.
2. With one agent at 9 of 10 green and another at 1 of 10 for a tag, learned routing picks the first most of the time and still explores: `packages/daemon/test/routing.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
