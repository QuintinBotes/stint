# R-011 · Cost meter

Day: 3 (29 Oct) · Owner: Q · Depends on: R-009, R-010 · Fallback: manual numbers in the recording · Cut: never

## Goal
Every run carries its tokens and its price, the task view totals them, the board shows the week, and the budget check stops a run before it overspends. "The economics are on screen" is this spec. It is also what makes the $0.00 review hop and the under-one-dollar task provable.

## Context
Prices per million tokens in `config.json` (R-003 defaults for Meta models; this spec makes the table editable). Meta prices cached input far below fresh input, so the cache-stable prefix rule is where savings come from; the meter must show cached tokens separately.

## Requirements
1. MUST implement `packages/daemon/src/cost.ts`: `price(hostModel, usage: { inputTokens, cachedTokens, outputTokens })` → `usd` from `config.prices` keyed by `host/model` (unknown key → `usd: null` and a `cost.unpriced` warning event, never a crash); cached tokens are priced at the host's cached rate, which is where Fireworks and Baseten reward the cache-stable prefix; `runCost(task, run)`, `taskCost(task)`, `weekCost()`, `byDay()`.
2. MUST ensure every `run.finished` event carries `payload.cost = { inputTokens, cachedTokens, outputTokens, usd }` from the adapter's usage object; adapters that cannot report usage (replay with no numbers) carry zeros and `estimated: true`.
3. MUST implement the budget check before every assign: role budget from `task.budgets` (fallback `config.budgets`) in tokens; the sum of the role's runs' `inputTokens + outputTokens` on this task plus the planned prompt's token count must stay under it, else `budget_exceeded` with the numbers in the hint; a run that reaches its cap mid-flight ends `capped` (adapters pass the remaining budget as `--max-model-steps` or `maxTurns` proportionally).
4. MUST add `GET /api/costs?group=task|run|day` and `stint costs [--by task|run|day]` printing one line per row with tokens, cached share and USD, and the board top strip's "this week" figure from the same route.
5. MUST add the `CostMeter` component to the UI (week in the top bar; per run in the rail segment header; per task in the task header; the Factory view bars arrive in R-019) with `font-variant-numeric: tabular-nums` so it does not jitter.
6. MUST show "credits left" per host in the top bar and the Factory view from `config.credits` minus metered spend on that host (Baseten $100 and Fireworks $25 from the hackathon partners, Meta credits as entered), rendered with "≈" because the figure is derived, not read from the provider; SHOULD replace it with the provider's own balance when an API exposes one.

## Interfaces
- `cost` object shape is the one in `schemas/handoff.schema.json` (`inputTokens`, `cachedTokens`, `outputTokens`, `usd`).
- `GET /api/costs?group=task` → `[{ key: 'T-0042', inputTokens, cachedTokens, outputTokens, usd, runs }]`.

## Acceptance
1. Known usage `{ 18420, 11200, 3910 }` on `meta-api/muse-spark-1.3` with the default prices yields `usd` 0.0276 ± 0.0001: `packages/daemon/test/cost.price.test.ts`.
2. A local Glimmer run prices at `usd: 0` with its token counts kept; the same usage on `fireworks/muse-spark-open` prices cached tokens at $0.15 per million and the run cost differs from an uncached run by exactly that: same file.
3. Assigning an implementer run when the role's spend plus the prompt exceeds the budget returns `budget_exceeded` with `hint` naming spent, prompt and cap: `packages/daemon/test/budget.test.ts`.
4. `GET /api/costs?group=day` on the replayed recording returns one row per day with the sum equal to the task totals: `packages/daemon/test/costs.route.test.ts`.
5. The task header shows the task total and each rail segment its run cost after the replay: `apps/web/e2e/cost.spec.ts`.
6. After two priced runs on `baseten`, `/api/costs?group=host` shows `creditsLeft` as 100 minus their sum, flagged `derived: true`: `packages/daemon/test/costs.route.test.ts`.

## Verify
```
bun test packages/daemon
bun run test:ui
```

## Out of scope
The benchmark (R-021), charts (R-019).

## Notes
Keep money in USD with four decimals internally, two on screen (except under $0.01, show four). The week is Monday to Sunday in the user's local zone. The meter must never show a number it did not compute; `estimated: true` renders as "≈".
