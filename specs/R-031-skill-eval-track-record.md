# R-031 · Skill eval, probation and retirement

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-020, R-021, R-030

## Goal
Learning that is not measured makes agents worse (SkillsBench: self-generated skills averaged minus 1.3 points). A skill earns active only after an eval shows it helps, and a skill that hurts is proposed for retirement.

## Requirements
1. MUST implement `stint eval --skill <id> [--tasks <ids>] [--replay]`: R-021's harness with a skills dimension; for the skill's evidence tasks plus one held-out task, run the implementer with the skill mounted and without, on fresh fixture copies; record per run findings (from the review), verification result, tokens and cost; write `.stint/evals/<skill>.json` and emit `skill.evaluated { id, with, without }`.
2. MUST show the eval on the skill proposal card and the Skills page: "with skill: N findings, M passed; without: ..." and the cost both ways.
3. MUST give skills a status `probation` after approval (frontmatter `status: probation`) that becomes `active` when the track record shows helped >= 3; helped = a task with the skill mounted approved with no repeat finding on the skill's theme; hurt = a repeat finding, a rejection, or an `outcome.reverted` while mounted; record with `skill.status` events.
4. MUST propose retirement through the same queue when hurt > helped (`skill.retire_proposed`); approving it sets `status: retired`.
5. MUST mount probation and active skills both, and show the track record (applied, helped, hurt) on the Skills page.

## Acceptance
1. `stint eval --skill limiter-config-via-env --replay` on recorded runs writes the eval file and the card text: `packages/cli/test/eval.skill.test.ts`.
2. A skill with three helped tasks moves from probation to active; one with hurt > helped raises a retirement proposal: `packages/daemon/test/skills.track.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
