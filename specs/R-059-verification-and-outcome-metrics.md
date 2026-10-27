# R-059 · Verification and outcome metrics, defined

Day: added 27 Oct at the owner's request · Owner: MC · Depends on: R-005, R-030, R-042, R-044 · Fallback: requirements 1 to 3 and 6 · Cut order: 6

## Goal
One defined set of verification and outcome metrics, computed by one pure function from the event logs, served by the daemon, shown in the Factory and the CLI, and written down with every definition, so "is the factory getting better" has numbers anyone can recompute.

## Context
Verification is the daemon's own run of the task's checks after every run: `verification.ran` carries `status`, `passed`, `failed`, `tamper`, `scenarios` and `coverage` (`packages/daemon/src/verifier.ts`, `docs/verify.md`). Outcomes after merge are `outcome.*` events read by `outcomesFromEvents` into `OutcomeRecord` (`packages/core/src/project/index.ts`: reverted, followup, ci, incident). Runs come from `runsFromEvents`; merges are `merge.completed`; reviews are `review.recorded`; packets are `handoff.created`; the scoreboard (`packages/core/src/project/scoreboard.ts`) already counts attempts and passes per agent. The Factory is `apps/web/src/routes/Factory.tsx`. Use the event types and payload fields as they exist in `EVENT_TYPES` and the daemon; where a metric below needs a field that is not recorded, say so in its definition and compute what is recorded, never invent data.

## Requirements
1. MUST add `packages/core/src/project/metrics.ts` with a catalogue `METRICS`, each entry `{ id, group: 'verification' | 'outcome', name, unit: 'share' | 'count' | 'usd' | 'minutes' | 'points', definition, formula, sources }` (definition is one plain sentence; formula names numerator and denominator; sources lists the event types), and a pure function `metrics(tasks: Array<{ task: Task; events: StintEvent[] }>, opts: { now: Date; windowDays: number; agent?: string; tag?: string }): MetricsReport` returning `{ windowDays, from, to, rows: Array<{ id, value: number | null, numerator: number | null, denominator: number | null, n: number }> }`. A value is null when its denominator is 0 or nothing was measured; never 0 in its place.
2. MUST define at least these, with an event inside the window counted by its time and a task counted when its defining event falls inside the window:
   - Verification: `first_pass_green` (share of tasks whose first implementer run's verification was green), `verification_green_rate` (green verifications over all verifications), `handoff_recovery` (share of runs started from a packet whose verification was green), `tamper_rate` (verifications with a tamper not allowed by a `tests:` decision, over verifications), `scenario_pass_rate` (held-out scenarios passed over scenarios run), `coverage_delta` (mean of branch minus base coverage in points, over verifications that measured both), `time_to_green` (median minutes from task creation to its first green verification).
   - Outcome: `merged` (merges), `lead_time` (median minutes from task creation to merge), `revert_rate` (merged tasks reverted within 7 days of their merge, over merged tasks), `change_failure_rate` (merged tasks with a revert, a failing CI outcome or an incident, over merged tasks), `followup_rate` (merged tasks with a follow-up, over merged tasks), `incidents` (incidents linked to merged tasks), `findings_per_review` (mean findings per recorded review), `needs_you_rate` (share of tasks where autopilot stopped for a person), `cost_per_merged_task` (priced spend on merged tasks over merged tasks, USD, null when nothing was priced).
   `agent` keeps the runs and verifications of that adapter and the tasks it merged as implementer; `tag` keeps tasks carrying that tag.
3. MUST serve `GET /api/metrics?window=7|30|90&agent=&tag=` returning the report and the catalogue: `{ ...MetricsReport, catalogue: METRICS }`. Default window 30; any other window is 400 `invalid`.
4. MUST add `stint metrics [--window 30] [--agent <id>] [--tag <tag>] [--json]`, printing per group a table of name, value (shares as percentages, minutes as hours and minutes, USD to 4 places, "none" for null), numerator over denominator, and n, then each definition once.
5. MUST add a Factory panel "Verification and outcomes": the two groups, each metric's value with its numerator over denominator, its definition visible on the page (not only on hover), a 7, 30 and 90 day switch, and an empty state that says what fills it.
6. MUST write `docs/metrics.md`: one table per group with id, name, definition, formula, source events and unit, then how the window and the filters work. A test fails when a catalogue id is missing from it.

## Interfaces
- `METRICS`, `metrics()`, `MetricsReport`, exported from `@stint-dev/core`.
- `GET /api/metrics?window=&agent=&tag=` → `MetricsReport & { catalogue }`.
- `api.metrics(window, filters?)` in `apps/web/src/api.ts`.

## Acceptance
1. On a hand-built set of event logs, `metrics()` gives the exact expected value for every metric, null where the denominator is 0, and respects the window and both filters: `packages/core/test/metrics.test.ts`.
2. After the replay, `GET /api/metrics` returns the catalogue and values that match the replay (one merge in T-0042; T-0042's first implementer run's verification counted); `window=12` is 400: `packages/daemon/test/metrics.route.test.ts`.
3. `stint metrics --json` prints the report and the table form names every metric: `packages/cli/test/metrics.test.ts`.
4. The Factory shows the panel with each definition on the page and switches the window: a new test in `apps/web/e2e/factory.spec.ts`.
5. `docs/metrics.md` names every catalogue id: `packages/core/test/metrics.docs.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh && bun run test:ui
```

## Out of scope
Exporting metrics to OpenTelemetry; alerting; per-file metrics.
