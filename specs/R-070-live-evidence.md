# R-070 · Live evidence: the relay on unseen repositories, a control that must stop, a scorecard, and learning over time

Day: 6 to 7 (30 to 31 Oct) · Owner: CC · Depends on: R-012, R-021, R-034, R-046, R-057, R-068 · Fallback: the relay on one repository and the scorecard · Cut order: 1 (never cut the relay)

## Goal
Stint's one claim no rival makes is that the task outlives the agent. Today the headline story is a hand-written replay plus one live hand-off. A judge can call that staged. This spec makes it measured: the full relay (an agent is killed mid-task, a different agent continues from the packet, a third finishes) run live three times on repositories Stint has never seen, with every run published; a control task that should be stopped and is; a scorecard of what verification and review catch; and the learning loop shown over more than five tasks. Spend is capped by the owner (29 Oct): up to $40 on the Meta Model API with the Muse Code allowance, and up to $25 on Baseten.

## Requirements
1. **Three unseen repositories:** small, permissively licensed public repositories in TypeScript or JavaScript with a working test command, cloned to a scratch folder at a pinned commit. For each, one seeded task with hidden acceptance tests written for it (held-out scenarios, R-037), sized so a single agent needs more than one run.
2. **The relay, per repository:** Muse Code starts the task and is stopped mid-run (`stint` stop, as a person would); Claude Code on Muse Glimmer (Ollama) continues from the packet; when it ends, Codex on Muse Spark 1.3 continues from the next packet and finishes; Stint verifies, Glimmer reviews offline, and the run stops at the gate. Each agent runs through Stint's own adapters. Every event log, packet, diff, verification and cost is kept under `bench/relay/<repo>/`.
3. **The control:** one task on one of the repositories that should be stopped: its hidden tests cannot pass without editing the locked tests. Stint must stop it (tamper guard or red verification) and never reach a green gate. Kept with the others.
4. **The scorecard** (`bench/scorecard.json`, rendered in docs/proofs.md and on the Factory): for seeded tasks with hidden tests on Muse Spark Open (Baseten) and Meta's hosted models, report: hand-off success (continued runs that went green), bad patches caught by the tests alone and by tests plus review, review false alarms (findings on patches the hidden tests accept), cost and time per merged task, and pass^k where run. Every figure says how many runs it rests on.
5. **Learning over time:** a sequence of at least six related tasks on one repository where a repeated review finding becomes a proposed skill, the owner-like approval is scripted and recorded as such, and later tasks run with it. The Factory gains a small chart: review findings per merged task in order, with a mark where each skill was approved. The chart reads from events, so the replay and live data both draw it.
6. **Honesty:** each published run says what was live, which models and hosts, the cost, and anything that was retried or scripted. A failed relay is published as failed, with what broke.

## Acceptance
1. `bench/relay/` holds three relay runs with all three agents in each and a verification at the end; a test reads them and checks the agent order, the packets between runs, and that each run's events validate.
2. The control is stopped before the gate, recorded and tested the same way.
3. `bench/scorecard.json` validates against its schema; docs/proofs.md and the README's evidence table link to it.
4. The Factory chart renders from the replay in a browser test, with the approval marks.
5. Total spend recorded in the runs stays within the owner's caps; the sum is printed in docs/proofs.md.
