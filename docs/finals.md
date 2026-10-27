# Finals kit

For the live judging on 9 November. Run order: live mode if the network and keys hold, the replay of the live run if not (`stint demo`), and the 60-second version if time is cut.

## The 60-second version

1. **The board (0:00):** "Coding agents lose the work when the session ends. In Stint the task outlives the agent."
2. **T-0042, Muse Code building on Muse Spark (0:10):** kill it. "The daemon builds the packet from the log and the diff: 412 tokens."
3. **The Stint agent continues (0:25):** it picks up from the packet on Muse Spark. "The daemon, not the agent, runs the tests: green."
4. **Glimmer reviews on the laptop, offline (0:40):** a finding that would reverse a decision goes to the queue. Approve. A real merge with trailers.
5. **The Factory (0:50):** which Muse model did what, what it cost, and the skill it learned. "Every model is Meta's; the benchmark is in the repository."

## Questions to expect

**How is this not Vibe Kanban, or any other agent board?**
A board shows tasks. Stint keeps a task alive across agents. Every run ends with a packet built by the daemon from the log and the diff, not from the agent's say-so, and any agent continues from it. The daemon runs the tests itself, so "done" is not an agent's claim. Decisions are protected from reviewers, the factory learns rules from recurring findings, and we measured the packet against the transcript instead of assuming it wins.

**Why not just use Muse Code's own subagents?**
Subagents live inside one session of one agent. When that session dies, they die with it, and so does the context. Stint works across sessions and across agents: Muse Code, Stint's own agent, or any other agent a person brings. A kill, a rate limit or a full context window is a hand-off, not a restart. Stint also adds what a single session cannot give itself: an independent test run, an offline reviewer, a memory across tasks, and a merge that only a person can approve.

**What happens when the packet is wrong?**
Four things limit the damage:
- **It cannot invent results.** The packet is derived from the log, so it cannot claim tests passed that did not. Verification is the daemon's own run.
- **We measure it.** The quiz asks a second model facts from the full record, answered from the packet alone, and the misses show what the packet dropped. The first live quiz found that the packet named files but not what the code did. The diff digest fixed that, and the benchmark showed 25% fewer tokens afterwards.
- **The next agent's checks still run.** The tests-first lock and the daemon's tests catch a wrong continuation before it can be merged.
- **The person merges, not an agent.**

**Can an agent fake the tests?**
Three things stop it:
- **The daemon runs the tests.** It never takes the agent's word for whether they passed.
- **The test files the plan names are locked** at the task's start commit. A run that weakens them turns the verification red, unless a person recorded a `tests:` decision saying why they had to change.
- **Held-out scenarios run in a checkout the agent never sees.** Only their counts come back.

The card says "33 passed, tests unchanged: test/webhooks.test.ts" only when a lock held.

**Why trust a skill the factory learned?**
You don't have to:
- **A person approves every skill.** Nothing is written without that approval.
- **It is measured.** The eval runs the task with the skill and without. Live on 27 October, both reviews came back clean, and the run with the skill cost $0.14 against $0.17.
- **It is watched.** A new skill starts on probation and becomes active after it helps on three tasks. One that hurts more than it helps is proposed for retirement.

**Will it merge without me?**
Not by default. The auto-approve lane is off, and only config turns it on, for the risk tiers named there (low by default). Even then it stays closed until it has a shadow record: at least three decisions over 14 days (configurable) where the person agreed with what the policy would have done. One disagreement, or one revert of a change it would have approved, inside that window closes it again.

**What did you build during the event?**
All of it, from 26 October; see `docs/timeline.md` and `PROGRESS.md`. The specs were the plan, written before the event. Parts of the code were written by Muse Code on Muse Wonder Full from a brief, and those commits carry a `Model:` trailer.

**Where are Meta's models used?**
Muse Wonder 1.0 plans and writes the quiz. Muse Spark 1.3 builds through Muse Code and continues through the Stint agent. Muse Glimmer 30B reviews offline and reads diffs. Muse Spark Open on Fireworks, Baseten and Modal is the fallback. The Factory view shows each model's tokens and cost from the meter.

## If an agent misbehaves on stage

Show a recorded packet instead: `bench/runs/*/handoff.json` holds ten real packets from the benchmark, and `stint packet T-0042 --as prompt` prints the replay's killed packet.
