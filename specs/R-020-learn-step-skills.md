# R-020 · Learn step and skills registry

Day: 7 (2 Nov) · Owner: Q · Depends on: R-010, R-017, R-018 · Fallback: a pre-recorded proposal in the replay · Cut order: 4

## Goal
The factory learns one rule from a review finding and proves it on the next task: on approve, the daemon checks the graph for a recurring finding or a repeated rejection reason, asks the model for a skill proposal with evidence, puts it in the same approval queue as code, writes `.agents/skills/<id>/SKILL.md` only when a person approves, mounts active skills by role and tags before every run, and emits `skill.applied` so the timeline and the graph link the skill to the outcome.

## Context
Proposal schema `schemas/skill-proposal.schema.json` (`stint.skillProposal/1`); skill frontmatter superset in `schemas/skill.schema.json` (`roles`, `origin`, `evidence`, `status` added to what Muse Code and other coding agents read). `review-voice-policy` is the first mounted skill and loads unchanged. The recurrence check runs on the graph (R-018), not on the model.

## Requirements
1. MUST implement the registry `packages/daemon/src/skills.ts`: scan `.agents/skills/*/SKILL.md` (tolerant frontmatter per R-002), list with `origin`, `roles`, `tags`, `status`, `evidence`, a consent digest (SHA-256 over the file; a skill changed since the person last approved it shows `stale`), and `GET /api/skills`, `POST /api/skills/:id/approve`, `POST /api/skills/:id/reject { reason }`, `POST /api/skills/:id/retire`, plus `stint skills list | approve <id> | reject <id> --reason`.
2. MUST mount before every run: select active skills by the run's role and the task's tags (and graph similarity when available), write the list into `prompt.md` (names and descriptions; Muse Code also reads the folder natively), copy or link nothing for Muse Code, list them in the Stint agent's system prompt, and emit `skill.applied { skill, run }` per skill.
3. MUST implement the learn trigger on `approval.granted` and on `approval.rejected`: build the learn input from `review.json` findings, `decisions.md`, the diff summary, the verification history of this task and the three most similar tasks; run the recurrence check on the graph: a finding whose normalised text (or `linksTo` risk) appears on ≥ 2 tasks, or a rejection reason cited twice → candidate; no candidate → emit `learn.skipped { reason }` and stop (no model call).
4. MUST call the learn chain from `config.routes.learn` (`baseten/muse-spark-open` first: Meta's open-weight model with a 1M context takes the whole evidence set in one call; then `meta-api/muse-spark-1.3`; then local Glimmer) once per candidate with structured output against the proposal schema, capped at 20k tokens, write the proposal to `.stint/cache/proposals/<id>.json`, emit `skill.proposed { id, evidence, confidence }`, and show it in the queue (R-019). Nothing is written under `.agents/skills` until approval.
5. MUST implement approve: write `.agents/skills/<id>/SKILL.md` with frontmatter `origin: learn-loop`, `evidence: [...]`, `status: active`, `roles`, `tags`, `version: 1.0.0`, and `examples.md` from the proposal's examples; commit it on the task branch or base branch (configurable, default base) with `Stint-Skill: <id>` trailer; emit `skill.approved`. Reject records the reason and the evidence set so the same evidence does not raise the proposal again.
6. MUST make the demo pair work: with the seeded T-0040 review (finding F2 "limits hard-coded") and T-0042's review (F1 on the same risk), approving T-0042 raises `limiter-config-via-env`; approving it and starting T-0043 shows `skill.applied` in r1's events and the review on T-0043 returns no finding on configuration (the replay encodes this; the live path is rehearsed).
7. SHOULD show a track record on the skill card: applied-in count, approvals without rejection after it, from `skillsHelped()`.

## Interfaces
- `GET /api/skills` → `Skill[]` with `{ id, name, description, roles, tags, origin, status, evidence, stale, appliedIn, helped }`.
- Proposal file shape: `schemas/skill-proposal.schema.json`.

## Acceptance
1. The registry lists `review-voice-policy` from the fixture with `origin: human` and `status: active`, and flags it `stale` after the file changes: `packages/daemon/test/skills.registry.test.ts`.
2. On the seeded fixture plus replayed T-0042, approving T-0042 emits `skill.proposed` with `id: 'limiter-config-via-env'` and evidence containing both `T-0042/…#F1` and `T-0040/…#F2`; with T-0040's finding removed, it emits `learn.skipped { reason: 'no recurrence' }` and makes no model call: `packages/daemon/test/learn.test.ts` (fake model server).
3. Approving the proposal writes `.agents/skills/limiter-config-via-env/SKILL.md` with the right frontmatter and a commit carrying `Stint-Skill:`; rejecting it twice with the same evidence raises it once: same file.
4. Assigning T-0043 as implementer emits `skill.applied` for the new skill and `review-voice-policy`, and `prompt.md` lists both: `packages/daemon/test/skills.mount.test.ts`.
5. `stint skills list` prints both with their origin: `packages/cli/test/skills.test.ts`.

## Verify
```
bun test packages/daemon packages/cli
```

## Out of scope
Skill editing UI beyond approve/reject, automatic retirement.

## Notes
A skill with one occurrence is a proposal only if a human asks; the recurrence rule keeps the loop honest and cheap. Keep the learn prompt in `packages/daemon/prompts/learn.md`. The proposal's `rule` becomes the SKILL.md body verbatim after approval; the person can edit it in the queue before approving (text field in R-019's panel).
