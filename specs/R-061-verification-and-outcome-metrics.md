# R-061 · Verification and outcome metrics, defined once

Day: 3 (29 Oct) · Owner: CC · Depends on: R-029, R-030, R-031, R-037, R-039, R-045, R-046 · Fallback: the projection, `/api/metrics`, and `docs/metrics.md` only; no Factory panel or series · Cut order: 2

## Goal
Every number Stint shows about whether the factory works has one written definition, one implementation, and one place to read it. Today the parts exist but are scattered and partly duplicated: the verify suite, the tamper guard, scenarios, outcomes, the scoreboard, golden pass^k, the phase gates, the shadow record, skill track records, and the Factory KPIs. Nothing measures first-pass quality, escaped defects per merge, cost per good merge, or how much a person had to step in. This spec adds a pure projection, `metrics()`, over the event logs. It covers four groups, verification, outcomes, human load, and learning, plus efficiency. Each metric has an id, a formula, a sample size, and a link to its definition. The scoreboard, the phase gates, and the Factory read their numbers from it, so two screens never disagree.

## Context
Sources, all in the per-task `events.jsonl` unless noted:

- **Verification.**
  - `verification.ran` has `status` green or red, a `reason`, `checks[]`, and `run`.
  - `verification.tampered` and `acceptance.tampered` carry `allowedBy` when a `tests:` decision explains them.
  - `scenario.ran` has `passed`, `failed`, and `names`.
- **Review.** `review.recorded` carries a verdict of approve, request_changes, or block, and lenses.
- **Approval.**
  - `approval.requested`.
  - `approval.granted` has `by`, which is `policy` for the auto-approve lane.
  - `approval.rejected` has `changes: true` for a request for changes.
- **Merge and outcomes.**
  - `merge.completed`.
  - `outcome.reverted`, `outcome.followup` (within 7 days), `outcome.ci`, and `outcome.incident` (R-030, R-042).
- **Runs and handoffs.**
  - `run.started` and `run.finished` carry role, adapter, model, `endedBy`, `cost`, and `adoptedFrom` for best of n.
  - `handoff.created` carries the packet and its tokens.
- **Shadow record.** `autoapprove.shadow` (R-039).
- **Skills.** `skill.evaluated`, `skill.status`, and the skill track book in `packages/daemon/src/skills.ts`.
- **Human events.** Events with `vendor: 'human'`: `human.command`, `decision.recorded`, `permission.decided`, `approval.rejected`, and `approval.granted` when `by` is not `policy`.

Existing computations this spec unifies:

- `scoreboard()` in core (R-045): attempt pass rate, cost per resolved task, and reverts, per tag, agent, and model.
- `phaseGates()` (R-046): golden pass^3 and tamper escapes.
- The Factory KPIs in `apps/web/src/routes/Factory.tsx`: in flight, runs and hops, week spend, cache share, and transcript share.
- The golden results in `bench/golden-results.json`.

## Definitions (the source of truth for `docs/metrics.md`)

**Shared terms.**
- **Window.** A window is `[from, to)` in UTC. Each metric says which event places a task or run in the window.
- **Verified implementer run.** An implementer run with at least one `verification.ran` for that run, excluding runs adopted from a best-of-n candidate (count them on the candidate, as the scoreboard does).
- **Green run.** A run that ended `completed` and whose last verification for that run is `green`. Tamper and scenario failures already make a verification red (R-029, R-037).
- **Mature merge.** A merge with `merge.completed.ts <= now - outcomeWindowDays` (`config.metrics.outcomeWindowDays`, default 7). Outcome rates use mature merges only. An outcome counts when its event falls within `outcomeWindowDays` after the merge.
- **Small sample.** Every metric reports `n`. The value is `null` when `n` is 0, and `small` is true when `n < 5`.

| Id | Group | Definition | Population and window anchor | Unit |
|---|---|---|---|---|
| `verify.first_pass` | verification | Share of tasks whose first verified implementer run is green | Tasks whose first verified implementer run's verification falls in the window | ratio |
| `verify.attempt_pass` | verification | Green runs divided by verified implementer runs; must equal the scoreboard's `passRate` for tag `*` | Verified implementer runs by verification ts | ratio |
| `verify.handoff_success` | verification | Share of continued runs that are green. A continued run is an implementer run that starts after a `handoff.created` on the same task | Continued runs by verification ts | ratio |
| `verify.tamper_rate` | verification | Share of verified implementer runs with an unexplained `verification.tampered` or `acceptance.tampered` (no `allowedBy`) | Verified implementer runs | ratio |
| `verify.tamper_explained` | verification | Count of tamper events with `allowedBy` | Tamper events by ts | count |
| `verify.tamper_escapes` | verification | Count of tasks with an unexplained tamper event that still merged; must equal the phase gate's count; target 0 | Merges in window | count |
| `verify.scenario_catch` | verification | Share of verifications where the `tests` check was green and `scenario.ran` failed | Verifications with a `scenario.ran` for the same run | ratio |
| `verify.review_catch` | verification | Share of tasks whose first review after a green verification is `request_changes` or `block` | Tasks with such a review, by review ts | ratio |
| `verify.golden_pass1` | verification | pass@1 from `bench/golden-results.json`, with its `k`, date, and commit | Not windowed; reports the file's date | ratio |
| `verify.golden_passk` | verification | pass^k from the same file | Not windowed | ratio |
| `outcome.merged` | outcome | Count of merges | Merges in window | count |
| `outcome.escaped_defect` | outcome | Share of mature merges with at least one `outcome.reverted`, failing `outcome.ci`, or `outcome.incident` within the outcome window | Mature merges in window | ratio |
| `outcome.revert` | outcome | Share of mature merges with `outcome.reverted` | Mature merges | ratio |
| `outcome.ci_failure` | outcome | Share of mature merges with a failing `outcome.ci` | Mature merges | ratio |
| `outcome.incident` | outcome | Count of `outcome.incident` on merges in window | Merges in window | count |
| `outcome.followup` | outcome | Share of mature merges with `outcome.followup` | Mature merges | ratio |
| `outcome.lead_time` | outcome | Median and p90 of `merge.completed.ts - task.created.ts` | Merges in window | ms |
| `outcome.cycle_time` | outcome | Median and p90 of `merge.completed.ts` minus the first `run.started.ts` | Merges in window | ms |
| `outcome.cost_per_merge` | outcome | Total priced cost of every run on merged tasks and their best-of-n children, divided by merges. `null` and an `unpriced` count when any run is unpriced | Merges in window | usd |
| `outcome.cost_per_good_merge` | outcome | Total cost of every task that reached a terminal state in the window (a mature merge, or `abandoned`), divided by mature merges without an escaped defect. The factory's unit cost, including its waste | Terminal tasks in window | usd |
| `human.interventions` | human | Mean count of human events on a merged task before its first human or policy `approval.granted`, excluding `task.created` | Merges in window | count |
| `human.autonomy` | human | Share of merged tasks with zero interventions | Merges in window | ratio |
| `human.first_time_approval` | human | Share of merged tasks with no `approval.rejected` before the merge | Merges in window | ratio |
| `human.approval_wait` | human | Median and p90 from `approval.requested` to the next human `approval.granted` or `approval.rejected` | Decisions in window | ms |
| `human.policy_agreement` | human | Share of shadow records where the policy's would-approve matched the person's decision, as R-039 computes it | Shadow records in window | ratio |
| `learn.skills` | learning | Count of skills by status | Now | count |
| `learn.skill_net` | learning | Among skills applied in 3 or more tasks, the share with helped greater than hurt | Now | ratio |
| `learn.proposal_yield` | learning | Approved proposals divided by proposals approved or rejected | Decisions in window | ratio |
| `learn.eval_delta` | learning | Mean of (findings without minus findings with) and of (passed with minus passed without) over `skill.evaluated` | Evals in window | count |
| `efficiency.hops` | efficiency | Mean implementer runs per merged task | Merges in window | count |
| `efficiency.packet_tokens` | efficiency | Median packet tokens of `handoff.created` | Handoffs in window | tokens |
| `efficiency.cache_share` | efficiency | Cached input tokens divided by input tokens, over all priced runs | Runs finished in window | ratio |
| `efficiency.transcript_share` | efficiency | The Factory's "Fed forward as transcripts" figure, moved here unchanged | As today | ratio |

**Attribution for `by=agent|model|tag`.**
- A verification metric belongs to the agent and model of its implementer run.
- An outcome or human metric belongs to the resolving agent: the last implementer run before the merge, which is the scoreboard's rule.
- A tag breakdown counts a task under each of its tags and under `*`.

## Requirements
1. MUST implement `metrics(input)` in `packages/core/src/metrics/` as a pure function of task bundles, workspace events, skills track data, golden results, config, `now`, a window, and an optional `by`. It does no I/O. It returns `stint.metrics/1`. Every id in the Definitions table is present with `value`, `n`, `small`, `unit`, `group`, `label`, `definition: 'docs/metrics.md#<id>'`, and, for ms metrics, `p50` and `p90`.
2. MUST add `schemas/metrics.schema.json` (`stint.metrics/1`), its zod mirror, an example in `packages/core/schemas/examples/`, and the agreement test, as for the other schemas.
3. MUST make `scoreboard()` and `phaseGates()` agree with `metrics()` for the shared numbers: attempt pass rate per agent and model, tamper escapes, and golden pass^k. Either they call it, or a test asserts equality on the same fixture. Change no existing scoreboard field.
4. MUST add `GET /api/metrics?window=7d|30d|90d|all&by=agent|model|tag&series=week`. With `series=week`, it returns one `stint.metrics/1` per ISO week in the window, oldest first.
5. MUST add `stint metrics [--window 30d] [--by agent] [--json] [--check]`.
   - The default output is one screen: a line per metric with the value, `n`, and "small sample" where it applies.
   - `--check` exits 1 when any metric with a target in `config.metrics.targets` misses it, and names each one. That makes it usable in CI.
6. MUST add `config.metrics`:
   - `{ outcomeWindowDays: number (default 7), targets?: { [id]: { min?: number; max?: number } } }`.
   - It is validated at load. An unknown id in `targets` is refused with the list of known ids.
   - No targets ship by default.
7. MUST add a Factory panel, "Verification and outcomes":
   - The four groups, each figure with its value, `n`, a "small sample" marker, and "below target" or "on target" when a target exists.
   - A link from each label to `docs/metrics.md#<id>`.
   - A window switch (7, 30, or 90 days).
   - The existing KPI row reads `efficiency.*` and `outcome.merged` from the same response.
8. MUST write `docs/metrics.md`:
   - One section per id, with an anchor equal to the id, holding the definition, population, unit, what moves it, and the event types it reads.
   - A short "Reading these numbers" part: small samples, mature merges, and why `cost_per_good_merge` is the headline cost.
   - Suggested starting targets, labelled as suggestions and not as measured norms:
     - `verify.first_pass` min 0.6;
     - `verify.tamper_escapes` max 0;
     - `outcome.escaped_defect` max 0.05;
     - `verify.golden_passk` min 0.8;
     - `human.approval_wait` p50 max 4 hours.
   - Link it from `docs/verify.md`, `docs/evals.md`, `docs/release.md`, and the docs index.
9. SHOULD add the metrics block, for the window since the previous report, to `stint report` output.
10. SHOULD export the metric values as OTLP gauge points from `stint otel export --metrics`, with the attribute `stint.metric.id`.

## Interfaces
- `metrics(input: { tasks: Array<{ task: Task; events: StintEvent[] }>; workspaceEvents?: StintEvent[]; skills?: SkillTrackBook; golden?: GoldenResults | null; config: Config; now: string; window: { from: string | null; to: string }; by?: 'agent' | 'model' | 'tag' }): Metrics`.
- The output is `Metrics = { version: 'stint.metrics/1'; window; by: string | null; generatedAt; groups: { [group]: MetricValue[] }; breakdown?: Array<{ key: string; metrics: MetricValue[] }> }`.
- Each entry is `MetricValue = { id; group; label; unit: 'ratio'|'count'|'usd'|'ms'|'tokens'; value: number | null; n: number; small: boolean; p50?: number; p90?: number; unpriced?: number; target?: { min?: number; max?: number; met: boolean }; definition: string }`.
- `GET /api/metrics` and `stint metrics`, as in Requirements 4 and 5.

## Acceptance
1. A synthetic fixture of eight tasks, written by hand in `packages/core/test/fixtures/metrics/`, covers:
   - first-time green;
   - red then green after a handoff;
   - unexplained tamper that merged;
   - explained tamper;
   - scenario-caught;
   - reverted within the window;
   - followed up;
   - merged yesterday (not mature);
   - policy-approved;
   - unpriced.

   Every id returns the value computed by hand in the test, with a comment showing the arithmetic. Test: `packages/core/test/metrics.test.ts`.
2. On the same fixture, `scoreboard()` attempt pass rates equal `verify.attempt_pass` by agent and model, and `phaseGates()` tamper escapes equal `verify.tamper_escapes`. Test: `packages/core/test/metrics.agree.test.ts`.
3. The output validates against `schemas/metrics.schema.json`. Test: `packages/core/test/schemas.agree.test.ts` (extended).
4. Every id in `metrics()` has a section in `docs/metrics.md` with that anchor, and every section is an id. Test: `packages/core/test/docs.metrics.test.ts`.
5. `GET /api/metrics?window=all&by=agent&series=week` on the replayed demo returns validating objects. An unknown `by` returns `invalid` (400). Test: `packages/daemon/test/metrics.route.test.ts`.
6. `stint metrics --check` with a `verify.tamper_escapes` max of 0 exits 1 on the fixture and names the metric. Without targets, it exits 0. Test: `packages/cli/test/metrics.test.ts`.
7. The Factory shows the panel, the window switch changes the values, and each label links to its anchor. Test: `apps/web/e2e/factory.spec.ts` (extended).

## Verify
```
bun test packages/core packages/daemon packages/cli
bun run typecheck
bun run build:web && bun run test:ui
./packages/cli/bin/stint metrics --window all --json | head -c 400
```

## Out of scope
- Statistical tests and confidence intervals beyond `n` and the small-sample flag.
- Dashboards outside Stint.
- Changing how any underlying event is produced.

## Notes
- No metric reads a transcript or calls a model. Everything comes from the log, so the replay produces stable numbers and a recording reproduces them.
- When a definition here disagrees with an existing computation, this table wins for `metrics()`, and the existing view switches to it. Record a Decision naming the old behaviour.
- Keep each metric a small named function in `packages/core/src/metrics/defs/<group>.ts`, so the docs test can walk the registry.
