# R-036 · The planner reads the memory, and splits work into a graph

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-010, R-018, R-025

## Goal
Plans that use what the factory learned, and tasks that run in parallel when they can.

## Requirements
1. MUST feed the planner prompt with `similar` (top 3 with evidence) and `constrains` (decisions and open findings on the files the task names) from the memory graph, recorded in the plan as `similarTasks` and `constraints`.
2. MUST let the planner return `subtasks: [{title, goal, acceptance, dependsOn: [index]}]` for a task too large for one run (the plan schema gains it); the daemon creates them as tasks with `parent` and `dependsOn`, emits `task.decomposed`, and the parent waits until its children are done.
3. MUST make the scheduler honour `dependsOn`: autopilot and Run all never start a task whose dependencies are not done; independent tasks run in parallel up to `autopilot.parallel`; the board shows the parent with its children and a dependency line.

## Acceptance
1. The planner prompt contains the similar task and the constraining decision from the graph: `packages/daemon/test/plan.memory.test.ts`.
2. A plan with three subtasks (one depending on another) creates three tasks; the dependent one starts only after its dependency is done: `packages/daemon/test/plan.dag.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
