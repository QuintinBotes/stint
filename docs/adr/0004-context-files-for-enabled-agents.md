# ADR-0004: Other agents' context files are made only when that agent is on

Status: Accepted, 27 Oct 2026 (D-044). Spec: R-048 Req 1 and 2.

## Context
R-048 has `stint init` create `CLAUDE.md` as a link to `AGENTS.md` and copy approved skills to `.claude/skills`. Stint is Meta first and other agents are opt in (ADR-0001); a workspace that only runs Meta models should not grow files for vendors it does not use.

## Decision
The link and the skills copy are made when that agent's preset is enabled. Turning an agent on and running `stint init` again creates them; nothing else changes.

## Consequences
- A Meta-only workspace carries `AGENTS.md` and `.agents/skills` only.
- Enabling Claude Code or Gemini CLI gives it the same shared context in one step.
