# R-054 · Routing, cost and the packet, as specified

Day: added 27 Oct from the requirements audit · Owner: MC · Depends on: R-009, R-010, R-011, R-012, R-025 · Fallback: requirements 4, 6 and 7 · Cut order: 5

## Goal
Finish what R-009 to R-012 and R-025 asked of routing, budgets, cost and the packet, so every model call is capped, priced or flagged unpriced, and the packet carries everything a next agent needs.

## Context
Routing is `packages/daemon/src/route.ts` and `routes/models.ts` (`chainFor`, `planTask`, `modelRun`); budgets and steps are set in `packages/daemon/src/lifecycle.ts`; the packet is built in `packages/daemon/src/handoff.ts` (`deriveHandoff`), served by `routes/handoff.ts`; Muse Code is `packages/adapters/muse-code`; `stint up` is `packages/cli/src/up.ts`; the autopilot route is `routes/runs.ts`.

## Requirements
1. MUST let a task override any role's chain (`task.routes.<role>`, validated like `config.routes`), used by `chainFor` before the config's chain.
2. MUST cap the plan call at the planner's token budget (`maxTokens` from `budgets.planner`) and the review call at the reviewer's.
3. SHOULD, on `stint up`, warm the reviewer's first local model in the background (one short request with `keep_alive` of 30 minutes) and check each hosted key with the host's model list, reporting both in the up output.
4. MUST emit `cost.unpriced` for a plan, review, learn, summary or quiz call whose host and model have no price, as runs already do.
5. MUST pass Muse Code a step cap derived from the remaining budget (`--max-model-steps`), not only from config.
6. MUST show credits left in the Factory, per host, marked "≈" with the note that they are derived from metered spend.
7. MUST carry the carried-in `askOfNext` into the next packet's `open` when the run did not close it, and add `risk:` lines the agent wrote in its messages to `risks`.
8. MUST honour `POST /api/tasks/:id/handoff { enrich: true }` by asking the leaving session (R-009 enrich) before building the packet.
9. MUST resume Muse Code with the instruction written to a prompt file (`--prompt-file`), not the full first prompt.
10. MUST generate the Muse wire schema with `bun run --cwd packages/adapters/muse-code gen:schema` (`muse schema generate-json-schema` and `generate-ts`) into `src/generated/`, type the mapper's records from the generated types, and, under `STINT_LIVE=1`, assert the saved schema matches the installed `muse`.
11. MUST return `step` (the step autopilot is on: plan, build, verify, review, approve, or idle) from the autopilot routes beside `on`, `running` and `queued`.

## Interfaces
- `Task.routes?: Partial<Record<Role | 'agent' | 'learn' | 'summary' | 'quiz' | 'recall', string[]>>`.
- Autopilot route response: `{ on, step, running, queued }`.

## Acceptance
1. A task route overrides the config's planner chain: `packages/daemon/test/route.task.test.ts`.
2. The plan call carries the planner budget as `maxTokens`: `packages/daemon/test/plan.budget.test.ts`.
3. `stint up` warms a fake local host once and reports each key: `packages/cli/test/up.test.ts`.
4. An unpriced review emits `cost.unpriced`: `packages/daemon/test/cost.unpriced.test.ts`.
5. A packet after a run that left the ask open lists it under `open`, and an agent's `risk:` line lands in `risks`: `packages/daemon/test/handoff.fields.test.ts`.
6. A hop's packet prompt contains none of the previous hop's `done` items: `packages/daemon/test/handoff.multihop.test.ts`.
7. `gen:schema` writes the schema and types, and the mapper compiles against them: `packages/adapters/muse-code/test/schema.test.ts`.
8. The Factory shows credits left with "≈": `apps/web/e2e/factory.spec.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh && bun run test:ui
```

## Out of scope
Provider balance APIs; pricing tables beyond `prices`.

## Notes
Warming Glimmer takes minutes on a busy 32 GB machine (memory: glimmer-warmup); the warm-up never blocks `stint up`.
