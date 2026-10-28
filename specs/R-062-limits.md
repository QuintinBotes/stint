# R-062 · Limits you set: builds, hand-offs, review rounds, spend and agent time

Day: 4 (29 Oct) · Owner: CC · Depends on: R-011, R-025, R-035, D-060 · Fallback: builds, hand-offs and spend only, set in config and `stint new`; no edit route or UI meters · Cut order: 3

## Goal
A software factory lets the person who owns the work say how much it may spend before it stops and asks. Stint has the parts but not the control. Autopilot caps hand-offs (`autopilot.maxHops`, config only) and stops after one review round and after two builds in a row with no progress, but:
- the hand-off count resets when autopilot is switched off and on;
- the dollar cap `budgets.usdCap` is in the task schema and nothing reads it;
- nothing caps builds, review rounds or agent time;
- none of it can be set per task;
- hitting a cap has no event of its own, only a free-text "Needs you" reason.

This spec adds per-task limits with config defaults. They are counted over the task's whole life, enforced before any work starts that would break them, recorded when reached, and shown as meters.

## Context
- `nextStep(events, task, settings, live)` in `packages/daemon/src/autopilot.ts` is a pure function of the log. Today's caps live there:
  - `hops >= s.maxHops`, counted over `autopilotTail` only;
  - `noProgress`;
  - `rounds >= 1` for review changes.
- `assign` in `packages/daemon/src/lifecycle.ts` refuses a run over the role's token budget (`budget_exceeded`, D-033). Token budgets stay as they are; limits sit beside them.
- Spend is `costs()` in core (R-011, D-060). Only a task's own spend counts here: its runs, plus the calls that are not runs recorded in its log (digest, pick, learn, quiz).
- `task.json` is `stint.task/1` (`packages/core/src/schemas/task.ts`, mirrored by `schemas/task.schema.json` with the agreement test). Config is `packages/core/src/schemas/config.ts`.
- There is no route that edits a task after it is created.

## Definitions
Each counter covers the task's whole log, not the autopilot tail.
- **Builds:** implementer runs that ended (`run.finished`), excluding runs adopted from a best-of-n candidate. A candidate's builds count on the candidate.
- **Hand-offs:** `autopilot.step` events with step `hand` or `escalate`.
- **Review rounds:** builds started because a review asked for changes (`autopilot.step` with `step: 'build'` and `changes`).
- **Spend:** the sum of `usd` over the task's runs and the calls in its log, as `costs()` counts them. An unpriced call counts $0 and sets `unpriced` on the meter.
- **Agent time:** the sum of wall time from `run.started` to `run.finished` over the task's runs, in minutes. A run still going counts its time so far.

## Requirements
1. MUST add `limits` to `stint.task/1` in zod and in `schemas/task.schema.json`: `limits?: { builds?: int 1..50, handoffs?: int 0..20, reviewRounds?: int 0..10, usd?: number > 0 up to 1000, minutes?: int 1..1440 }`. A field left out takes the config default; a field that is null means no limit. `budgets.usdCap`, when set and `limits.usd` is not, is read as `limits.usd`.
2. MUST add `config.limits` (the defaults for new tasks): `{ builds: 8, handoffs: 3, reviewRounds: 1, usd: null, minutes: null }`. `autopilot.maxHops`, when set in a user's config, stays the default for `handoffs`, so existing configs keep their meaning. `effectiveLimits(task, config)` lives in core and is the only place that merges the task's limits with the defaults.
3. MUST add `taskUsage(events)` in core: a pure function returning `{ builds, handoffs, reviewRounds, usd, unpriced, minutes }` per the Definitions. The meters, autopilot and R-063 all read this one function.
4. MUST enforce the limits in `nextStep`, before the step that would break them, with lifetime counts from `taskUsage`:
   - no build or hand-off once `builds` is reached;
   - no hand-off or escalation once `handoffs` is reached;
   - no review-changes build once `reviewRounds` is reached (this replaces the fixed `rounds >= 1`);
   - nothing new once `minutes` is reached;
   - for spend, nothing new once `usd` is reached, and no build whose expected cost would cross it. The expected cost is the median `usd` of this task's earlier builds; with no earlier build, the check is spend `>= usd`.
   The existing no-progress stop stays.
5. MUST record the stop. Write `limit.reached { limit, used, cap }`, then `autopilot.stopped` with `needsYou: true`, `limit` set, and a plain reason such as "Needs you: the build limit is reached (8 of 8)." or "Needs you: the next build would pass the $3.00 spend limit ($2.71 spent; builds here cost about $0.40)." Add both event types to `EVENT_TYPES` and `schemas/event.schema.json`. The task status is not changed.
6. MUST add `PATCH /api/tasks/:id/limits` (daemon token required) with a strict body of the `limits` shape. It writes `task.json` and records `limits.changed { from, to, by }`, with `vendor: 'human'` when the request comes from a person. Raising a reached limit does not restart autopilot by itself; switching autopilot on again does. A malformed body answers 400 with the field.
7. MUST add CLI flags and a command:
   - `stint new … --max-builds N --max-handoffs N --max-review-rounds N --max-usd D --max-minutes N`, and the same fields in the strict `POST /api/tasks` body;
   - `stint limits <task> [--max-… …] [--none <limit>]`, which prints the meters (used, cap) and changes limits through the route.
8. MUST show limits in the web UI, following DESIGN.md:
   - **New task dialog:** a native `<details>` called "Limits" with four number fields (builds, hand-offs, spend in dollars, agent minutes). Each field's placeholder shows the default, and the field has a one-line hint. Review rounds are CLI and config only.
   - **Task view title block:** one row of meters, for example "Builds 3 of 8 · Hand-offs 1 of 3 · Spend $0.61 of $3.00 · Agent time 12 min". A meter with no cap shows the used value only. Meter bars are square and in ink. Amber appears only when a limit is reached and the task needs you.
   - **When a limit is reached:** the task view shows the stop with two actions, "Raise the limit" (an inline form that PATCHes, then turns autopilot on) and "Hand to another agent" (the existing hand-to control). Each target is at least 24 px, with a visible focus ring and an `Explain word="limit"` disclosure.
   - Add `limit` to `apps/web/src/glossary.ts`: "A cap you set on a task, on builds, hand-offs, spend or agent time. Stint stops and asks you before it would go past one."
9. MUST update the docs: `docs/factory.md` (limits and what happens when one is reached), `docs/agents.md` where it describes autopilot caps, the README's autopilot paragraph if it names `maxHops`, and the config reference wherever config keys are listed.

## Interfaces
- core: `TaskLimits` type, `effectiveLimits(task, config)`, `taskUsage(events)`, exported from `@stint-dev/core`.
- daemon: `PATCH /api/tasks/:id/limits`; `nextStep` returns `{ kind: 'stop', needsYou: true, reason, limit }` for a limit.
- events: `limit.reached`, `limits.changed`.
- R-063 reads `effectiveLimits` and `taskUsage`; R-064 goal limits reuse the `limits` shape.

## Acceptance
- A unit test on `nextStep`: with `builds: 2`, two failed builds stop with `limit: 'builds'` rather than a hand-off. The same log with `autopilot.started` written twice still counts 2, so a restart does not reset it.
- A unit test: `usd: 1` with earlier builds at $0.40 and $0.50 and $0.70 spent stops before a third build. With no earlier build and $0.20 spent it builds.
- A unit test: `reviewRounds: 2` allows a second changes build and stops at the third request.
- A unit test on `taskUsage`, covering adopted runs, escalations, a live run's minutes and an unpriced call.
- A daemon test: PATCH without the token is 401; a bad body is 400; a good one writes `task.json` and `limits.changed`.
- A schema agreement test covering `limits`, and an old `task.json` without `limits` that still parses.
- An e2e flow (`apps/web/e2e/flows/`): create a task with "Builds 1" from the dialog, let a failing fake build run, see the meter at "1 of 1" and the stop, raise the limit to 2 inline, and see autopilot take the next build.
- `bun run typecheck`, the unit tests, `node scripts/guard-identity.mjs` and the a11y spec pass.

## Verify
`bun run typecheck && bun test packages/core packages/daemon packages/cli && node scripts/guard-identity.mjs`, then the touched Playwright specs plus `e2e/a11y.spec.ts`.

## Out of scope
Limits for a whole goal (R-064), automatic extensions, and changing token budgets.

## Notes
Orbit's "allowance below a hard cap, extended on measurable progress" was considered. Stint keeps a single cap the person sets, because the owner asked for a maximum they choose. The no-progress stop already covers the waste an allowance prevents.
