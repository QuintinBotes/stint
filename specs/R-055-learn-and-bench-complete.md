# R-055 · The learn step and the bench, complete

Day: added 27 Oct from the requirements audit · Owner: MC · Depends on: R-018, R-020, R-021 · Fallback: requirements 1 and 2 · Cut order: 6

## Goal
Finish what R-020 and R-021 asked: skills mount for tasks that are similar as well as tagged, the skill commit goes where the person says, and the bench covers hosts and every leg within the hosts' rate limits.

## Context
Skills mount through `skillsFor(role, tags)` in `packages/daemon/src/lifecycle.ts`; approving a skill commits it in `packages/daemon/src/skills.ts`; the bench is `packages/cli/src/bench.ts` and `packages/cli/src/bench/live.ts`; similarity is `similar()` in the graph (`packages/core/src/graph`).

## Requirements
1. MUST mount a skill for a task that is similar (top three by `similar()` with a score at or above `skills.similarity`, default 0.5) to a task in the skill's evidence, besides role and tag matches, and record which rule mounted it in `skill.applied`.
2. MUST commit an approved skill to `skills.commitTo` (default: the checked-out base branch), refusing a branch that does not exist.
3. MUST add `--host <id>` to `stint bench` to run the continuing leg on one host's model.
4. MUST add the plan, review and learn legs to the bench (`--legs plan,build,review,learn`, default `build`), each recorded with its cost and result.
5. MUST default concurrency to 2 and bound it by the host's `tpm` and `rpm` with a token bucket, waiting rather than failing when the bucket is empty.

## Interfaces
- Config: `skills.similarity: number`, `skills.commitTo: string`.
- `stint bench [--host <id>] [--legs <list>] [--concurrency <n>]`.
- `skill.applied { skill, by: 'role' | 'tag' | 'similar' }`.

## Acceptance
1. A skill mounts on an untagged task similar to its evidence task, by `similar`: `packages/daemon/test/skills.mount.test.ts`.
2. With `skills.commitTo` set, approve commits there; a missing branch is refused: `packages/daemon/test/skills.commit.test.ts`.
3. `stint bench --replay --host fireworks --legs plan,build` reads and writes those legs: `packages/cli/test/bench.replay.test.ts`.
4. The token bucket holds a third concurrent call until the window frees: `packages/cli/test/bench.limits.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```

## Out of scope
New bench tasks; a hosted bench runner.

## Notes
`skill.applied` gains a payload field, not a new event type.
