# Evals: skills on probation, and the golden tasks

Learning that is not measured can make agents worse, so a learned skill has to earn its place twice: once in an eval before it is trusted, and again on real tasks after it mounts. The golden tasks do the same job for the factory as a whole: a small set of real failures that must keep passing, every time.

## Skill eval

```
stint eval --skill limiter-config-via-env
stint eval --skill limiter-config-via-env --tasks T-0042,T-0043
stint eval --skill limiter-config-via-env --replay
```

The eval runs the implementer on the skill's evidence tasks plus one held-out task (the most recent other task with the same tags), twice per task on fresh copies of the repository: once with the skill mounted, once with the skill folder removed. Each run records the review findings, the daemon's verification result, the tokens and the cost. The summary lands in `.stint/evals/<skill>.json`, a `skill.evaluated` event carries the two sides on the first evidence task's timeline, and the run artefacts stay in `.stint/evals/<skill>/runs/` so `--replay` can rebuild the same numbers with no model call. The proposal card and the Skills page print one line from it:

```
with skill: 1 findings, 99 passed, cost $0.0385; without: 5 findings, 97 passed, cost $0.0355
```

A proposed skill can be evaluated before it is approved: the with side writes the proposal into the copy, the without side leaves it out.

## Probation, active, retired

Approving a proposal writes the skill with `status: probation`. Probation and active skills both mount. After every approval, rejection and task outcome the daemon recomputes each skill's track record from the event logs:

- helped: a task with the skill mounted was approved with no repeat finding on the skill's theme. A repeat is the evidence finding's text again, the same risk link, or two or more shared theme words.
- hurt: a task with the skill mounted raised a repeat finding, was rejected, or was reverted after merge (`outcome.reverted`).

Probation becomes active at three helped tasks. The change is written to the SKILL.md frontmatter and committed, with a `skill.status` event naming the counts. When hurt passes helped, the daemon records `skill.retire_proposed` and the Skills page shows the proposal with Retire and Keep buttons. Retire sets `status: retired` in the same committed way. Keep clears the proposal until the counts change. The Skills page shows applied, helped and hurt on every skill. Statuses are computed on writes, never on a read.

## Golden tasks

`bench/golden/<name>.json` holds one task that must keep passing: a title, a goal, acceptance criteria, the test command, an optional fixture commit, and optional scenarios (held-out grader commands run in the run's worktree after the daemon's verification). Three ship with the repository, taken from the bench tasks on the demo fixture.

```
stint eval --golden --k 3
stint eval --golden --k 3 --replay
stint eval add-golden T-0042
```

Each golden task runs k times on fresh fixtures. A run passes when the daemon's verification is green and every scenario exits 0; each run records an `eval.ran` event on its fixture task. Results land in `bench/golden-results.json` with the recorded runs in `bench/golden-runs/` for replay. Two numbers are reported: pass@1, the share of tries that pass, and pass^k, the share of tasks where every try passes. Work that must succeed every time is judged on pass^k.

The first live run, 27 October: Muse Code on Muse Spark 1.3, three golden tasks, k 3. All nine tries passed the daemon's verification, so pass@1 and pass^3 are both 100%, for $1.40 at list prices ($0.10 to $0.23 a try, about 85% of input from cache). An earlier attempt the same morning lost two tries to the laptop sleeping mid-run; the live commands now hold off idle sleep, and the test cap counts only time the machine was awake. Nine tries on three tasks is a small sample.

`stint eval add-golden <task>` turns a rejected or reverted task into a golden task, so a real failure keeps being tested. A task that never failed is refused.

## Phase gates

The Factory shows two gates, computed by the daemon at `GET /api/phase-gates`:

- Phase 2 opens when the golden set passes pass^3 at 80% or better with no tamper escapes. A tamper escape is a task with an `acceptance.tampered` or `verification.tampered` event that still merged.
- Phase 3 opens when one risk tier has been shadow-approved (`autoapprove.shadow` records) for two weeks with no reverts on that tier.

Each gate says whether it is open and, when it is not, what is missing.
