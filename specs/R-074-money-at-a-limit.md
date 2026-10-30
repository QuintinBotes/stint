# R-074 · The UI shows money only where a person sets or meets a spend limit

Day: 5 (30 Oct) · Owner: CC · Depends on: R-007, R-054, R-061 · Fallback: the cost surfaces stay as they were · Cut order: 4

## Goal
The owner said on 30 Oct that the UI carried cost bookkeeping that only mattered while Stint was being built: hosted credit balances, the week's spend in the top bar, cost per day, spend per task, and a dollar figure on every card, run and log line. A person using Stint decides with limits, not with a running bill, so the UI keeps money only where a limit is set or met. Costs are still recorded in every task's log, the API still serves them, and `stint costs` still reports them.

## Requirements
1. The web UI MUST NOT show a dollar figure except a spend limit a person set, the spend measured against that limit, or a notice that the limit was reached.
2. The top bar MUST NOT show the week's spend, and neither it nor the status menu shows credits left.
3. The Factory MUST NOT show spend by task, cost per day, credits left, or a cost column or figure; Meta models at work keeps which model did which job and where it ran.
4. Board cards, the task view, the rail, the relay chart, the packet and review cards, the goal list and the outcome line MUST NOT show what a task or run cost.
5. The daemon, its API, the CLI and the event log are unchanged.

## Acceptance
1. `bash scripts/check.sh` and `bun run test:ui` pass, with the flows that checked removed figures changed to match.
2. A search of `apps/web/src` for `money(`, `moneyOf(` and `CostMeter` finds only the spend limit, its meter and the limit-reached notice.
3. `stint costs` prints the same rows as before.
