# Finals kit

This page is for whoever presents Stint at the live judging on 9 November: the run order, the 60-second version, the questions to expect and what to show when something fails.

Run in live mode if the network and keys hold, the replay (`stint demo`) if not, and the 60-second version if time is cut. If the laptop fails, the judge copy of the board, built with `bun run build:judge`, needs only a browser ([`demo.md`](demo.md#the-judge-copy)).

## The 60-second version

1. **The Board, at `/` (0:00):** "Coding agents lose the work when the session ends. In Stint the task outlives the agent."
2. **T-0042, Muse Code building on Muse Spark (0:10):** kill it. "The daemon builds the packet from the log and the diff: 412 tokens."
3. **The Stint agent continues (0:25)** from the packet on Muse Spark. "The daemon, not the agent, runs the tests: green."
4. **Glimmer reviews on the laptop, offline (0:40):** a finding that would reverse a decision goes to the queue. Approve: a real merge with trailers.
5. **The Factory, at `/factory` (0:50):** which Muse model did what, and the skill it learned. "Every model is Meta's; the benchmark is in the repository."

## Questions to expect

### How is this not Vibe Kanban, or any other agent board?

A board shows tasks; Stint keeps a task alive across agents. Every run ends with a packet the daemon builds from the log and the diff, not from the agent's say-so, and any agent continues from it. The daemon runs the tests itself, so "done" is not an agent's claim. Decisions are protected from reviewers, the factory learns rules from recurring findings, and we measured the packet against the transcript instead of assuming it wins.

### Why not just use Muse Code's own subagents?

Muse Code keeps its own work well: each subagent gets a worktree, its events go to a JSONL log, and `muse resume` brings a session back after a crash. Stint does what one agent's session cannot do for itself:

- **Any agent continues the task.** The packet is a few hundred tokens that any agent continues from, so when Muse Code hits its usage limit, the Stint agent on Muse Spark, Muse Spark Open or Glimmer on the laptop carries the task on. Live, one task each went from Muse Code to Claude Code to Codex on three repositories Stint had never seen.
- **Checks that are not the agent's own.** Stint runs the tests, Glimmer reviews on the laptop, a goal's tasks wait on each other, and nothing merges until a person approves.
- **It works with Muse Code, not around it.** Muse Code drives Stint over MCP, as the film shows.

### What happens when the packet is wrong?

Four things limit the damage:

- **It cannot invent results.** The packet is derived from the log, so it cannot claim tests passed that did not. Verification is the daemon's own run.
- **We measure it.** The quiz asks a second model facts from the full record, answered from the packet alone, and the misses show what the packet dropped. The first live quiz found that the packet named files but not what the code did. The packet now carries the leaving agent's account of what the code does, or a digest of the diff when the agent cannot be asked. On the current build, runs from the packet used 31% fewer input tokens than runs from the transcript and passed 9 of 10 against 3 of 5.
- **The next agent's checks still run.** The tests-first lock and the daemon's tests catch a wrong continuation before it can be merged.
- **A person merges, not an agent.**

### Can an agent fake the tests?

Four things stop it:

- **The daemon runs the tests.** It never takes the agent's word for whether they passed.
- **The test files the plan and the task name are locked** as they were at the task's start commit. A run that weakens them turns the verification red, unless a `tests:` decision recorded after the lock names each changed file and says why, and that decision is on the card for the person who approves.
- **Held-out scenarios run in a checkout the agent never sees.** Only their counts come back.
- **A visual proof is judged from a screenshot.** The daemon opens the page itself, and Muse Spark judges what it sees against the person's criterion; words on the page are never instructions to it.

The card says "33 passed, tests unchanged", with the locked file `test/webhooks.test.ts` under it, only when a lock held.

### Why trust a skill the factory learned?

You don't have to:

- **A person approves every skill.** Nothing is written without that approval.
- **It is measured.** The eval runs the task with the skill and without. Live on 27 October, both reviews came back clean, and the run with the skill cost $0.14 against $0.17.
- **It is watched.** A new skill starts on probation and becomes active after it helps on three tasks. One that hurts more than it helps is proposed for retirement.

### Will it merge without me?

Not by default. The auto-approve lane is off, and only config turns it on, for the risk tiers named there (low by default). Even then it stays closed until it has a shadow record: at least three decisions over 14 days (configurable) where the person agreed with what the policy would have done. One disagreement, or one revert of a change it would have approved, inside that window closes it again.

### What stops it spending too much, or building the wrong thing?

Four things:

- **Limits you set.** Each task has limits on builds, hand-offs, review rounds, spend and agent time, and autopilot stops and asks you before it would pass one. A goal sets them across all of its tasks.
- **Sharpen first.** Before work starts, Stint asks the few questions whose answers change what gets built, recommends an answer to each, and records yours as decisions every later run keeps.
- **How it went.** Each acceptance criterion says whether it was proven or only passes; a passing test proves it only if that test failed before the change. The gate says "Passes, but no test showed it failing first" when that is all there is.
- **Run all asks first.** Starting every planned task names which start now and which wait, the most builds any may use, the spend cap across them when every one has a spend limit, and that nothing merges without you.

### What did you build during the event?

All of it, from 26 October. [`timeline.md`](timeline.md) says what was built each day, and which specs were the plan, written before the event with the build kit. Muse Code on Muse Wonder Full wrote parts of the code from a brief, and the Owner column of each spec's row in `PROGRESS.md` says whether Muse Code or the author built it.

### Where are Meta's models used?

Muse Wonder 1.0 plans, asks Sharpen's questions and writes the quiz. Muse Spark 1.3 builds through Muse Code, continues through the Stint agent, drafts specs in the spec builder, and judges a page in the visual gate, where SAM 3.1 marks what it found wrong. Muse Glimmer 30B reviews offline, reads diffs and answers the quiz. Muse Spark Open on Fireworks, Baseten and Modal runs the learn step and is the fallback for the rest. The Factory shows each model's tokens from the meter, and `stint costs --by host` gives the spend.

## If an agent misbehaves on stage

Show a recorded packet instead: `bench/runs/*/handoff.json` holds ten real packets from the benchmark, and `stint packet T-0042 --as prompt` prints the replay's killed packet.
