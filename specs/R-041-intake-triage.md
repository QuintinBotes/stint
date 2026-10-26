# R-041 · Intake from GitHub and Linear, with triage

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-018, R-032

## Goal
Work arrives from where teams already track it.

## Requirements
1. MUST implement `stint intake github [--repo] [--label]` (through `gh issue list --json`) and `stint intake linear [--team]` (Linear GraphQL with the key from `config.intake.linear.keyEnv`), creating `intake.received` items in a queue, never tasks directly.
2. MUST triage each item with the planner chain: size (S, M, L), a proposed title, goal and acceptance criteria, duplicates found through the memory graph (`similar` over titles and goals), and a suggested risk tier; record `intake.triaged`.
3. MUST show intake items in an Intake panel on the board with Accept (creates the task with `source`), Merge into (an existing task), and Dismiss; a scheduled pull runs when `config.intake` is set.

## Acceptance
1. A fake `gh` returning two issues creates two intake items, triage marks one as a duplicate of an existing task, Accept creates a task with `source.kind: github`: `packages/cli/test/intake.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
