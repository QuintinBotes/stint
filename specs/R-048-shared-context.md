# R-048 · Shared context every agent reads

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-014, R-020

## Goal
Agents read different files. Stint keeps one source and links the rest.

## Requirements
1. MUST make `stint init` create `CLAUDE.md` as a symlink to `AGENTS.md` when it does not exist (a copy on systems without symlinks), and mention `.agents/skills`.
2. MUST copy approved skills to `.claude/skills/<id>/SKILL.md` as well as `.agents/skills`, in the same commit.
3. MUST route local models to review and summary roles before implementer roles in the default chains, and keep the validate-and-retry path for tool calls from local models.

## Acceptance
1. `stint init` creates the CLAUDE.md link and approving a skill writes both copies in one commit: `packages/cli/test/init.shared.test.ts`, `packages/daemon/test/skills.copy.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
