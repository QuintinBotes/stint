# R-051 · Every card carries its state, and the gate its record

Day: added 27 Oct from the requirements audit · Owner: MC · Depends on: R-016, R-017 · Fallback: the chips and blockers only · Cut order: 3

## Goal
Finish what R-016 and R-017 asked of the cards: every card says what state it is in, the review shows its blockers, the sign-off shows the full record, each run shows its permission tier, the plan shows which steps are done, and the Hand to picker explains each choice (ADR-0006).

## Context
Cards live in `apps/web/src/components/Cards.tsx` (HandoffCard, ReviewCard, PlanCard), the gate in `ApprovalGate.tsx`, the picker in `HandTo.tsx`, the rail header in `Rail.tsx` (`SegmentHead`). The bundle comes from `GET /api/tasks/:id` (`packages/daemon/src/app.ts`); `signoff.json` holds `{ by, at, verificationHash, commit }` (R-017). Review findings and `blockers` follow `schemas/review.schema.json`.

## Requirements
1. MUST give HandoffCard and PlanCard a `StatusChip` like the other cards, and an empty task's cards each show `planned` beside their empty-state sentence.
2. MUST render the review's `blockers` above its findings, each with its text, in the bad tone, under a heading that says how many there are.
3. MUST show the sign-off record on a merged task: who, when (local time), the verification hash (first 12 characters, the full value on hover), and the commit. The task bundle gains `merge.at` and `merge.verificationHash` from `signoff.json`.
4. MUST show a permission tier chip on each run's rail header: `manual` (a person approves), `auto, verified` (the auto-approve lane with the daemon's verify) or `never bypass` when the harness's own approvals are on, derived from the run's adapter gate and the task's risk tier.
5. MUST mark each plan step done or open from the latest packet (`done` and `open` lists match a step by its id or its text), and show the plan's files, risks and similar tasks.
6. MUST show in the Hand to picker, for each agent: its vendor, its roles, a capability note (resume, structured output, sandbox, cost reporting from health) and its gate strength; the recommendation follows ADR-0006 and states its reason.
7. MUST show `links.issueUrl` as a link in the task header and print it in `stint show`.

## Interfaces
- `TaskBundle.merge`: `{ commit, into, by, at, trailers, verificationHash }`.

## Acceptance
1. In an empty task every card shows its sentence and a `planned` chip: `apps/web/e2e/empty.spec.ts`.
2. A review with a blocker shows it above the findings: `apps/web/e2e/review-card.spec.ts`.
3. After the replay, T-0042's gate shows who, when, the verification hash and the commit: `apps/web/e2e/cards.spec.ts`.
4. Each T-0042 rail segment shows a tier chip: `apps/web/e2e/timeline.spec.ts`.
5. T-0042's plan card marks the steps the last packet lists as done: `apps/web/e2e/cards.spec.ts`.
6. The picker shows vendor, roles and capability note for each agent: `apps/web/e2e/flows/handoff-panel.spec.ts`.
7. A task created with an issue URL shows it in the header, and `stint show` prints it: `apps/web/e2e/flows/new-task.spec.ts`, `packages/cli/test/show.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh && bun run test:ui
```

## Out of scope
New event types; changes to `schemas/`.

## Notes
The replay's review has no blockers; the blocker test serves one through `page.route` or uses the flows daemon's fake reviewer.
