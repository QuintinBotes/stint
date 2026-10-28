# Metrics: verification and outcome numbers, defined once

This page is for anyone who reads Stint's verification and outcome numbers or sets targets on them. Every number Stint shows about whether the factory works has one written definition, one implementation and one place to read it. The definitions are in this file. The implementation is `metrics()` in `packages/core/src/metrics/`, a pure projection over the per-task event logs. Read the numbers with `stint metrics`, at `GET /api/metrics`, in the `stint report` metrics block, or on the Factory in the web UI. The output is `stint.metrics/1`; each value carries its sample size `n`, a `small` flag and a link back to its section here.

No metric reads a transcript or calls a model. Everything comes from the log, so a replay produces the same numbers as the live run did.

Shared terms:

- A window is `[from, to)` in UTC. Each metric says which event places a task or run in the window.
- A verified implementer run is an implementer run with at least one `verification.ran`, excluding runs adopted from a best-of-n candidate (counted on the candidate, as the scoreboard does).
- A green run ended `completed` and its last verification is `green`. Tamper and scenario failures already make a verification red.
- A mature merge merged at least `config.metrics.outcomeWindowDays` ago (default 7). Outcome rates use mature merges only. An outcome counts when its event falls within that many days after the merge.
- By agent or model, a verification metric belongs to its implementer run; an outcome or human metric belongs to the resolving agent, the last implementer run before the merge. By tag, a task counts under each of its tags and under `*`.

## On the Factory

The Factory opens on "What the agents did": a period switch (7, 30 or 90 days, or all; 30 days is the default), then tasks merged (`outcome.merged`, with `efficiency.hops`), spend this week (its own weekly source), passed the tests first time (`verify.first_pass`) and hand-offs that passed (`verify.handoff_success`), and a line with the packet size and the transcript share. "All measures" lists every metric by group with a plain label and a one-line definition, its sample, and "On target" or "Below target" when you set a target; each label links to its section on this page. A small sample is said once, above the groups.

Spend this week is `GET /api/costs?group=week`, which `stint costs --by week` prints. It is what finished runs, learn steps and packet quizzes cost between Monday 00:00 and Sunday 24:00 in the machine's local time. A run counts once, in the week it ended; a run still going counts once it ends. Week and day totals include learn and quiz spend; a task's total is its runs. A run or call with no price is counted in `unpriced`, never as $0. Each run is charged to the host that answered it, and Muse Code to the Meta Model API; another agent on its own command line is charged to itself, because Stint cannot see its account, so it draws no host's credits. Not counted yet, because no event records their cost: the diff digest for a killed run's packet, the board card summaries, intake triage and the autopilot's pick between candidates. The digest, the summaries and the pick start on local Glimmer at no cost and cost money only when they fall back to a hosted model; triage starts on the planner's hosted chain.

## Reading these numbers

Small samples: every metric reports `n`. The value is `null` when `n` is 0, and `small` is true when `n < 5`. A ratio over three tasks moves in thirds; treat it as a hint, not a rate. The CLI prints "small sample" beside such figures.

Mature merges: a merge from yesterday has had no time to be reverted, so counting it would flatter every outcome rate. Outcome rates therefore wait out the outcome window (7 days by default) and only then judge a merge. `outcome.merged` counts every merge at once; the rates catch up a week later.

Why `outcome.cost_per_good_merge` is the headline cost: `outcome.cost_per_merge` divides the spend on merged tasks by merges, which hides the tasks that were abandoned and the merges that later escaped a defect. `cost_per_good_merge` puts every terminal task's spend in the numerator, waste included, and only good merges in the denominator. It is the factory's unit cost, and it is the number to watch week to week.

## Suggested starting targets

These are suggestions, not measured norms. No targets ship by default. Set them under `config.metrics.targets` in `.stint/config.json`; `stint metrics --check` then exits 1 and names each metric that misses, which makes it usable in CI.

- `verify.first_pass` min 0.6
- `verify.tamper_escapes` max 0
- `outcome.escaped_defect` max 0.05
- `verify.golden_passk` min 0.8
- `human.approval_wait` p50 max 4 hours (14400000 ms; the metric value is its p50)

## Verification

<a id="verify.first_pass"></a>
### verify.first_pass

Definition: share of tasks whose first verified implementer run is green. Population: tasks whose first verified implementer run's verification falls in the window. Unit: ratio. What moves it: task clarity, plan quality and the implementer's first attempt. Reads: `run.started`, `run.finished`, `verification.ran`.

<a id="verify.attempt_pass"></a>
### verify.attempt_pass

Definition: green runs divided by verified implementer runs. It equals the scoreboard's `passRate` at tag `*`, and per agent and model. Population: verified implementer runs, placed by verification time. Unit: ratio. What moves it: how often any single attempt passes the daemon's verification. Reads: `run.started`, `run.finished`, `verification.ran`.

<a id="verify.handoff_success"></a>
### verify.handoff_success

Definition: share of continued runs that are green. A continued run starts after a `handoff.created` on the same task. Population: continued runs, placed by verification time. Unit: ratio. What moves it: packet quality; this is the number that says a hand-off carried enough. Reads: `run.started`, `run.finished`, `verification.ran`, `handoff.created`.

<a id="verify.tamper_rate"></a>
### verify.tamper_rate

Definition: share of verified implementer runs with an unexplained tamper event (no `allowedBy`). Population: verified implementer runs. Unit: ratio. What moves it: agents editing locked tests without a `tests:` decision. Reads: `run.started`, `verification.ran`, `verification.tampered`, `acceptance.tampered`.

<a id="verify.tamper_explained"></a>
### verify.tamper_explained

Definition: count of tamper events with `allowedBy`. The sample size `n` is every tamper event in the window. Population: tamper events, placed by their own time. Unit: count. What moves it: legitimate locked-test changes, each named by a `tests:` decision. Reads: `verification.tampered`, `acceptance.tampered`.

<a id="verify.tamper_escapes"></a>
### verify.tamper_escapes

Definition: count of tasks with an unexplained tamper event that still merged. The target is 0. Population: merges in the window. Unit: count. What moves it: any hole in the tamper guard or the approval gate. Reads: `verification.tampered`, `acceptance.tampered`, `merge.completed`.

<a id="verify.scenario_catch"></a>
### verify.scenario_catch

Definition: share of verifications where the `tests` check was green and the held-out scenarios failed. Population: verifications with a `scenario.ran` for the same run. Unit: ratio. What moves it: how much the held-out scenarios catch that the visible tests miss. Reads: `verification.ran`, `scenario.ran`.

<a id="verify.review_catch"></a>
### verify.review_catch

Definition: share of tasks whose first review after a green verification is `request_changes` or `block`. Population: tasks with such a review, placed by review time. Unit: ratio. What moves it: defects the tests cannot see but a reviewer can. Reads: `verification.ran`, `review.recorded`.

<a id="verify.golden_pass1"></a>
### verify.golden_pass1

Definition: pass@1 from `bench/golden-results.json`. Population: not windowed; `n` is the golden task count. Unit: ratio. What moves it: single-try success on the golden set. Reads: no events; the golden results file only.

<a id="verify.golden_passk"></a>
### verify.golden_passk

Definition: pass^k from `bench/golden-results.json`, the share of golden tasks that pass every one of k tries. Population: not windowed; `n` is the golden task count. Unit: ratio. What moves it: repeatable success, which is what the phase 2 gate reads. Reads: no events; the golden results file only.

## Outcome

<a id="outcome.merged"></a>
### outcome.merged

Definition: count of merges. Population: merges in the window. Unit: count. What moves it: throughput; every other outcome rate is judged against these merges once they mature. Reads: `merge.completed`.

<a id="outcome.escaped_defect"></a>
### outcome.escaped_defect

Definition: share of mature merges with at least one revert, failing CI outcome or incident within the outcome window. Population: mature merges in the window. Unit: ratio. What moves it: anything verification, review and approval all missed. Reads: `merge.completed`, `outcome.reverted`, `outcome.ci`, `outcome.incident`.

<a id="outcome.revert"></a>
### outcome.revert

Definition: share of mature merges with a revert. Population: mature merges. Unit: ratio. What moves it: changes that had to be backed out. Reads: `merge.completed`, `outcome.reverted`.

<a id="outcome.ci_failure"></a>
### outcome.ci_failure

Definition: share of mature merges with a failing CI outcome. Failing means the outcome status is failure, failed, error, timed out or action required. Population: mature merges. Unit: ratio. What moves it: breakage the base branch's CI found after merge. Reads: `merge.completed`, `outcome.ci`.

<a id="outcome.incident"></a>
### outcome.incident

Definition: count of incident outcomes on merges in the window, within the outcome window of each merge. The sample size `n` is merges in the window. Population: merges in the window. Unit: count. What moves it: production harm traced to a merge. Reads: `merge.completed`, `outcome.incident`.

<a id="outcome.followup"></a>
### outcome.followup

Definition: share of mature merges with a follow-up task touching the same files. Population: mature merges. Unit: ratio. What moves it: work the first change left behind. A follow-up is not always a defect; it is a signal to read beside the escaped defect rate. Reads: `merge.completed`, `outcome.followup`.

<a id="outcome.lead_time"></a>
### outcome.lead_time

Definition: median and p90 of merge time minus task creation time. The metric value is the p50. Population: merges in the window. Unit: ms. What moves it: queue time, build time and approval wait together. Reads: `task.created`, `merge.completed`.

<a id="outcome.cycle_time"></a>
### outcome.cycle_time

Definition: median and p90 of merge time minus the first run's start. The metric value is the p50. Population: merges in the window. Unit: ms. What moves it: the working part of lead time, once an agent starts. Reads: `run.started`, `merge.completed`.

<a id="outcome.cost_per_merge"></a>
### outcome.cost_per_merge

Definition: total priced cost of every run on merged tasks and their best-of-n children, divided by merges. It is `null` with an `unpriced` count when any run has no price. Population: merges in the window. Unit: usd. What moves it: spend per landed change, before judging whether the change held. Reads: `run.started`, `run.finished`, `merge.completed`.

<a id="outcome.cost_per_good_merge"></a>
### outcome.cost_per_good_merge

Definition: total cost of every task that reached a terminal state in the window (a mature merge, or `abandoned`), divided by mature merges without an escaped defect. It is `null` with an `unpriced` count when any of those runs has no price. Population: terminal tasks in the window; `n` is the good merges. Unit: usd. What moves it: the factory's true unit cost, waste included. Reads: `run.started`, `run.finished`, `merge.completed`, `outcome.reverted`, `outcome.ci`, `outcome.incident`.

## Human

<a id="human.interventions"></a>
### human.interventions

Definition: mean count of human events on a merged task before its first human or policy approval, excluding `task.created`. Human events are events with vendor `human` of type `human.command`, `decision.recorded`, `permission.decided` or `approval.rejected`. Population: merges in the window. Unit: count. What moves it: how much a person had to step in before approval. Reads: `human.command`, `decision.recorded`, `permission.decided`, `approval.rejected`, `approval.granted`, `merge.completed`.

<a id="human.autonomy"></a>
### human.autonomy

Definition: share of merged tasks with zero interventions. Population: merges in the window. Unit: ratio. What moves it: tasks the factory carried to approval untouched. Reads: `human.command`, `decision.recorded`, `permission.decided`, `approval.rejected`, `approval.granted`, `merge.completed`.

<a id="human.first_time_approval"></a>
### human.first_time_approval

Definition: share of merged tasks with no `approval.rejected` before the merge. Population: merges in the window. Unit: ratio. What moves it: work a person accepts the first time it reaches the gate. Reads: `approval.rejected`, `merge.completed`.

<a id="human.approval_wait"></a>
### human.approval_wait

Definition: median and p90 from `approval.requested` to the next human approval or rejection. The metric value is the p50, so a `max` target reads as a p50 target. Population: decisions in the window. Unit: ms. What moves it: reviewer response time; policy approvals do not count as a decision here. Reads: `approval.requested`, `approval.granted`, `approval.rejected`.

<a id="human.policy_agreement"></a>
### human.policy_agreement

Definition: share of shadow records where the policy's would-approve matched the person's decision. Population: shadow records in the window. Unit: ratio. What moves it: how often the auto-approve policy sees a change the way the person does. Reads: `autoapprove.shadow`.

## Learning

<a id="learn.skills"></a>
### learn.skills

Definition: count of skills in the registry. Population: now, not windowed. Unit: count. What moves it: proposals a person approves, and retirements. Reads: no events directly; the skill registry the daemon builds from skill files and `skill.status` history.

<a id="learn.skill_net"></a>
### learn.skill_net

Definition: among skills applied in 3 or more tasks, the share with helped greater than hurt, as the skill track book counts them. Population: now, not windowed. Unit: ratio. What moves it: whether mounted skills earn their place. Reads: no events directly; the skill track book built from `skill.applied` and what followed.

<a id="learn.proposal_yield"></a>
### learn.proposal_yield

Definition: approved proposals divided by proposals approved or rejected. Population: proposal decisions in the window. Unit: ratio. What moves it: how often the learn step proposes something a person keeps. Reads: `skill.approved`, `skill.rejected`.

<a id="learn.eval_delta"></a>
### learn.eval_delta

Definition: over skill evals, the mean of the combined delta: findings without minus findings with, plus passed with minus passed without, halved so the two halves weigh the same. Positive means the skill helped on its eval. Population: evals in the window. Unit: count. What moves it: measured skill effect before a skill mounts widely. Reads: `skill.evaluated`.

## Efficiency

<a id="efficiency.hops"></a>
### efficiency.hops

Definition: mean implementer runs per merged task. Population: merges in the window. Unit: count. What moves it: retries, hand-offs and escalations per landed change. Reads: `run.started`, `merge.completed`.

<a id="efficiency.packet_tokens"></a>
### efficiency.packet_tokens

Definition: median packet tokens over hand-offs. Population: hand-offs in the window. Unit: tokens. What moves it: packet size; the packet budget keeps this in the hundreds. Reads: `handoff.created`.

<a id="efficiency.cache_share"></a>
### efficiency.cache_share

Definition: cached input tokens divided by input tokens, over all priced runs. Population: runs finished in the window. Unit: ratio. What moves it: prompt reuse across runs and roles. Reads: `run.finished`.

<a id="efficiency.transcript_share"></a>
### efficiency.transcript_share

Definition: the share of work fed forward as transcripts. It is 0 whenever a hand-off exists, because the next agent receives a packet, never a transcript. The sample size `n` is hand-offs in the window. Population: hand-offs in the window. Unit: ratio. What moves it: nothing, by design; it exists so the claim stays measured where the packets are counted. Reads: `handoff.created`.
