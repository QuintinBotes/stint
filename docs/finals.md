# Finals kit

This page is for whoever presents Stint at the live judging on 9 November: the run order, the 60-second version, the questions to expect, a five-minute check a judge can run, and what to show when something fails.

Run in live mode if the network and keys hold, the replay (`stint demo`) if not, and the 60-second version if time is cut. If the laptop fails, the judge copy of the board, built with `bun run build:judge`, needs only a browser ([`demo.md`](demo.md#the-judge-copy)).

## The 60-second version

1. **The Board, at `/` (0:00):** "Coding agents lose the work when the session ends. In Stint the task outlives the agent."
2. **T-0042, Muse Code building on Muse Spark (0:10):** kill it. "The daemon builds the packet from the log and the diff: a few hundred tokens, 412 in the replay."
3. **The Stint agent continues (0:25)** from the packet on Muse Spark. "The daemon, not the agent, runs the tests: green."
4. **Glimmer reviews on the laptop, offline (0:40):** a finding that would reverse a decision goes to the queue. Approve: a real merge with trailers.
5. **The Factory, at `/factory` (0:50):** which Muse model did what, and the skill it learned in the replay. "Every model is Meta's; the benchmark is in the repository."

## Questions to expect

### How is this not Vibe Kanban, or any other agent board?

A board shows tasks; Stint keeps a task alive across agents. Every run ends with a packet the daemon builds from the log and the diff, not from the agent's say-so, and any agent continues from it. The daemon runs the tests itself, so "done" is not an agent's claim. Decisions are protected from reviewers, the factory learns rules from recurring findings, and we measured the packet against the transcript instead of assuming it wins.

### How is this different from tools that run agents on a ticket queue and merge on their own?

Those tools answer how many agents can clear a queue without a person. Stint answers what happens to one task when its agent dies. When a queued run fails, it goes back to the queue and starts over; in Stint, another vendor's agent continues from a packet of a few hundred tokens. The daemon then runs the tests itself, on locked test files and held-out scenarios the agent is never shown. Every model Stint calls at runtime is Meta's, the review runs on the laptop at $0, and nothing merges without a person.

### Why not just use Muse Code's own subagents?

Muse Code keeps its own work well: each subagent gets a worktree, its events go to a JSONL log, and `muse resume` brings a session back after a crash. Stint does what one agent's session cannot do for itself:

- **Any agent continues the task.** The packet is a few hundred tokens that any agent continues from, so when Muse Code hits its usage limit, the Stint agent on Muse Spark, Muse Spark Open or Glimmer on the laptop carries the task on. Live, one task each went from Muse Code to Claude Code to Codex on three repositories Stint had never seen.
- **Checks that are not the agent's own.** Stint runs the tests, Glimmer reviews on the laptop, a goal's tasks wait on each other, and nothing merges until a person approves.
- **It works with Muse Code, not around it.** Muse Code drives Stint over MCP, as the film shows.

### Is Meta essential, or could any model do this?

The hand-off is vendor-neutral by design: the packet is plain JSON with a published schema, and Claude Code, Codex and other agents are config entries that ship turned off. Meta's models are the default in every role, and every model Stint calls at runtime is Meta's ([`proofs.md`](proofs.md#meta-models-where-each-one-works)). Each one does a job: Muse Glimmer 30B is small enough to review on the laptop with the network off, at $0.00; Muse Spark 1.3 judges a screenshot and SAM 3.1 boxes the element it names, which is the visual gate; Muse Code's hooks draft a packet before context is lost. So the answer is both: Meta runs every job by default, and the packet is what lets you swap any of them.

### Why not just resume the session, or hand over the diff?

Resume brings back the same agent, with the same usage limit and often a full context; `muse resume` does that well. A packet lets a different agent continue: in the relays, Claude Code and then Codex continued tasks Muse Code started. On 2 November the bench was rerun from one shared start per task, with a third mode for the task and the diff alone. Every mode's code passed the held-out tests, 10 of 10. The daemon's verdict was green 10 of 10 from the packet, 7 of 10 from the transcript and 4 of 10 from the diff: on three tasks the first run had changed a locked test file without a decision, and only the packet told the next agent, in 864 tokens against 5,124 and 1,375 by Stint's estimate. The continuing agent wrote that `tests:` decision itself, and the gate shows it to you as high risk, so green there means the change reached you with its reason, not that anyone approved it. So the claim is that the packet carries what the daemon found, not that the next agent writes better code: four of the five checkpoints already passed. From checkpoints that were genuinely unfinished, every mode finished the code, Muse Code resuming its own session included, and the packet was the dearest, on two tasks and four runs per mode. So resume is the better tool when the same agent can carry on; the packet is for when it cannot, because it stopped, hit a limit or the task moves to another vendor ([`proofs.md`](proofs.md#the-unfinished-rerun-2-november)).

### Did the relay show that hand-offs help, or just that Codex is good?

It cannot tell them apart. In all five relays Muse Code and Claude Code left no changed files: the packet Codex started from listed nothing done and no changed files, only the task, the daemon's red verification and that the held-out scenarios failed. Codex wrote every green change and finished in 4 of the 5 relays; 3 of the 5, one per repository, reached the gate. What it does show is that the task outlived two agents that failed, every hop started from a packet and never a transcript, and the daemon, not an agent, decided green. Codex never ran these tasks alone, so the relay cannot say how much the packet added ([`proofs.md`](proofs.md#the-relay-one-task-three-agents)).

### Does the offline review protect me?

It keeps your code on your machine; Glimmer does not catch bugs. Rechecked on 2 November, Muse Spark 1.3 on the Meta Model API, the last host in the reviewer chain, flagged 5 of the 15 failing scorecard patches and none of the 3 passing ones ([`proofs.md`](proofs.md#live-evidence-29-october)). In the live scorecard Glimmer approved all 5 patches the hidden tests failed, in the first scorecard it approved all 9 empty diffs, and in one relay it asked for changes on a patch the hidden tests passed (`bench/scorecard.json`, `bench/relay/negotiator-2/tasks/T-0001/review.json`). What protects you is the daemon's verification, which review waits for; the queue that stops a finding from reversing a recorded decision; and your approval at the gate. Present review as advice.

### What happens when the packet is wrong?

Four things limit the damage:

- **It cannot invent results.** The packet is derived from the log, so it cannot claim tests passed that did not. Verification is the daemon's own run.
- **We measure it.** The quiz asks a second model facts from the full record, answered from the packet alone, and the misses show what the packet dropped. The first live quiz found that the packet named files but not what the code did. The packet now carries the leaving agent's account of what the code does, or a digest of the diff when the agent cannot be asked. On the current build, runs from the packet used 31% fewer input tokens than runs from the transcript and passed 9 of 10 against 3 of 5, in a small sample whose runs started from different checkpoints.
- **The next agent's checks still run.** The daemon's tests, the tests-first lock and any held-out scenarios run on the continuation before it can reach the gate, and they catch what they test.
- **A person merges, not an agent.**

### Can an agent fake the tests?

Four things stop it:

- **The daemon runs the tests.** It never takes the agent's word for whether they passed.
- **The test files the plan and the task name are locked** as they were at the task's start commit. A run that weakens them turns the verification red, unless a `tests:` decision recorded after the lock names each changed file and says why, and that decision is on the card for the person who approves. The agent can write that decision itself, so this stops a hidden edit, not a declared one: the gate rates the change high risk, and the auto-approve lane never takes it.
- **Held-out scenarios run in a separate checkout.** They never reach the agent's worktree, prompt or packet; only their counts and names come back. Under the `sandbox-exec` or `docker` sandbox the agent cannot read them; the default sandbox is `none`.
- **A visual proof is judged from a screenshot.** The daemon opens the page itself, and Muse Spark judges what it sees against the person's criterion; words on the page are never instructions to it.

The card says "33 passed, tests unchanged", with the locked file `test/webhooks.test.ts` under it, only when a lock held; in the replay that count is hand-written. The lock covers test files, not the runner's config, such as the `test` script in `package.json`, which shows only in the diff ([`verify.md`](verify.md#the-tamper-guard)). Live, the control task that could pass only by editing a locked test stopped red with no locked file edited (`bench/relay/negotiator-control/`).

### Why trust a skill the factory learned?

You don't have to:

- **A person approves every skill.** Nothing is written without that approval.
- **It is measured.** The eval runs the task with the skill and without. Live on 27 October, both reviews came back clean, and the run with the skill cost $0.14 against $0.17.
- **It is watched.** A new skill starts on probation and becomes active after it helps on three tasks. One that hurts more than it helps is proposed for retirement.

Say plainly that no skill has been learned in a live run yet. On 29 October seven tasks on vercel/ms were each approved with no findings, so nothing recurred and the learn step proposed nothing. In the replay the learn step is hand-written, and only the skill's eval is from a live run ([`proofs.md`](proofs.md#the-learning-sequence)).

### Will it merge without me?

Not by default. The auto-approve lane is off, and only config turns it on, for the risk tiers named there (low by default). Even then it stays closed until it has a shadow record: at least three decisions over 14 days (configurable) where the person agreed with what the policy would have done. One disagreement, or one revert of a change it would have approved, inside that window closes it again.

### What stops it spending too much, or building the wrong thing?

Four things:

- **Limits you set.** Each task has limits on builds, hand-offs, review rounds, spend and agent time, and autopilot stops and asks you before it would pass one. A goal sets them across all of its tasks.
- **Sharpen first.** Before work starts, Stint asks the few questions whose answers change what gets built, recommends an answer to each, and records yours as decisions every later run keeps.
- **How it went.** Each acceptance criterion says whether it was proven or only passes; a passing test proves it only if that test failed before the change. The gate says "Passes, but no test showed it failing first" when that is all there is.
- **Run all asks first.** Starting every planned task names which start now and which wait, the most builds any may use, the spend cap across them when every one has a spend limit, and that nothing merges without you.

### What did you build during the event, and was any product code written before the kickoff?

Yes, some, on the day the event began. [`timeline.md`](timeline.md) lists it: on 26 October from 15:15 to 17:00 CET, before the kickoff session, the scaffold and the first product code were committed (the event log and store, the daemon, worktrees and the verifier, the replay, the web UI shell, the terminal backend, the Muse Code adapter and the cost meter), and the packet builder's first draft was written then and committed after. `git log --until="2026-10-26 17:00 +0100"` lists every commit before the kickoff, with its real time. Everything after that, from the Stint agent and the hooks to the relays and the scorecard, was built during the event. The timeline also says which specs were the plan, written before the event with the build kit. Muse Code on Muse Wonder Full wrote parts of the code from a brief, and the Owner column of each spec's row in `PROGRESS.md` says whether Muse Code or the author built it.

### Where are Meta's models used?

Muse Wonder 1.0 plans, asks Sharpen's questions and writes the quiz. Muse Spark 1.3 builds through Muse Code, continues through the Stint agent, drafts specs in the spec builder, and judges a page in the visual gate, where SAM 3.1 marks what it found wrong. Muse Glimmer 30B reviews offline, reads diffs and answers the quiz. Muse Spark Open on Fireworks, Baseten and Modal runs the learn step and is the fallback for the rest. The Factory shows each model's tokens from the meter, and `stint costs --by host` gives the spend.

## Check one thing yourself, in five minutes

For a judge who would rather check a claim than take it. Each command was run on 2 November; steps 3 and 4 need git and Bun 1.3.14 or later.

1. Play the replay in a container, with nothing else installed:

```bash
docker run --rm --pull always -p 127.0.0.1:4319:4319 ghcr.io/quintinbotes/stint
```

2. Open http://127.0.0.1:4319/t/T-0042. The strip says "Replay, hand-written". Over the replay's 2 minutes 35 seconds Muse Code is killed and a packet appears anyway, the Stint agent's run goes green on the Tests tab, Glimmer's finding that contradicts D3 goes to the queue, and the task merges.
3. In a second terminal, get the repository and take a live packet. The ten benchmark packets are `bench/runs/*/handoff.json`; the second command takes the first packet of the Hugging Face dataset [`quintinbotes/stint-handoff-packets`](https://huggingface.co/datasets/quintinbotes/stint-handoff-packets), which is the live packet in [`proofs.md`](proofs.md#the-live-packet):

```bash
git clone https://github.com/QuintinBotes/stint && cd stint && bun install --frozen-lockfile
curl -sL https://huggingface.co/datasets/quintinbotes/stint-handoff-packets/resolve/main/data/packets.jsonl | sed -n 1p | bun -e 'process.stdout.write(JSON.parse(await Bun.stdin.text()).packet)' > packet.json
```

4. Validate it against the published schema, `packages/core/schemas/handoff.schema.json`, with the Ajv that `packages/core` installs for its tests:

```bash
cd packages/core
bun -e '
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
const schema = await Bun.file("schemas/handoff.schema.json").json();
const packet = await Bun.file(process.argv.at(-1)).json();
const validate = addFormats(new Ajv({ allErrors: true, strict: false })).compile(schema);
console.log(validate(packet) ? `valid ${packet.version}` : validate.errors);
process.exit(validate.errors ? 1 : 0);
' ../../packet.json
```

It prints `valid stint.handoff/1`. Pass `../../bench/runs/bench-03-delete-tenant-packet/handoff.json` instead to check a benchmark packet. Remove a required field such as `askOfNext` from the file and it prints the error and exits 1. The packet's `verification` says `runBy: "daemon"`: it is the daemon's record of the run, not the agent's claim.

5. Check which commit you are judging and what ran on it. Each push to `main` runs CI, and one that passes the smoke test publishes the image under `sha-` and the short commit:

```bash
git rev-parse --short=7 HEAD
gh run list --repo QuintinBotes/stint --commit "$(git rev-parse HEAD)" --limit 5
docker buildx imagetools inspect "ghcr.io/quintinbotes/stint:sha-$(git rev-parse --short=7 HEAD)"
```

The runs list `ci` and `docker` with their results, and the last command prints the image's digest, which `cosign verify` checks as [`docker.md`](docker.md#checking-what-you-run) shows.

## If an agent misbehaves on stage

Show a recorded packet instead: `bench/runs/*/handoff.json` holds ten real packets from the benchmark, and `stint packet T-0042 --as prompt` prints the replay's killed packet.

## If the laptop fails

Any machine with Docker plays the replay with nothing else to install: run `docker run --rm --pull always -p 127.0.0.1:4319:4319 ghcr.io/quintinbotes/stint` and open http://127.0.0.1:4319. The image is about 360 MB, so pull it on the backup machine before the session, and leave out `--pull always` there if the session has no network. [`docker.md`](docker.md) has the rest.
