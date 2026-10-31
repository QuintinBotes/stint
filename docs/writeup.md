# Stint: the task outlives the agent

This is Stint's submission write-up for the judges of the Meta Global AI Developer Hackathon. Theme: Push the Frontier, Meta's Muse Spark and Muse Glimmer on a hard problem in software. Track: indie developer.

## Pitch

Coding agents are good at a task until the session ends: the context fills, the process dies, the rate limit hits, or you want a different agent for the next step. The work is then stuck in a transcript nobody can hand on. Stint makes the task, not the chat, the unit of work: a folder in your repository that any agent can pick up. However a run ends, Stint writes a packet of a few hundred tokens that the next agent continues from. It runs every agent in its own git worktree, runs the tests itself, reviews offline, and merges only when a person says so. It is a software factory on your own machine, built on Meta's models end to end.

## Who it is for

- **Developers who already use a coding agent** and lose work when its session ends.
- **Small teams that want agents to work in parallel without losing track.** Every task's history is an event log in the repository, every merge names the task, runs and packet it came from, and decisions cannot be silently reversed.
- **Anyone who cannot send code to a cloud reviewer.** The review runs on the laptop.

## What it proves

| Claim | Evidence |
|---|---|
| A killed agent's work survives | Live, 26 October: Muse Code was killed mid-task on T-0042. The daemon built the packet from the log and the diff alone, and the Stint agent continued from it on Muse Spark 1.3. The daemon's test run passed 29 of 29, and the continued run cost $0.10. |
| The packet is enough, and we measured it | `stint bench`, five live tasks on the current build: the packet is about 925 tokens against 6,328 for the transcript, and 9 of 10 continued runs from it passed against 3 of 5 from the transcript, with 31% fewer input tokens at 11% less cost. The first run, on 26 October, passed 5 of 5 both ways at about the same cost, because the agent re-read code. The packet quiz found the gap, so the packet now carries the leaving agent's own account of what the code does, or a digest of the diff when the agent cannot be asked. |
| A task crosses agents on code Stint has never seen | Live, 29 October, on jshttp/negotiator, jeffbski/wait-on and vercel/ms: Muse Code started each task and was stopped, Claude Code on Muse Glimmer 30B continued from the packet, and Codex on Muse Spark 1.3 from the next one. All three tasks reached the gate with the hidden tests green (`bench/relay/`). Claude Code ran to its 15 minute limit in every relay and left the task red, so Codex made each green change: hand-off success was 4 of 10 continued runs. The first negotiator and ms relays did not reach the gate, and both stay published. |
| Single runs are scored against the same hidden tests | The live scorecard, 29 October: three single runs per relay task by the Stint agent on Muse Spark Open passed the hidden tests 3 of 9, and a green attempt cost $0.49 and took 6 minutes (`bench/scorecard.json`). The relays used other agents and models, so this is not a controlled comparison. The first scorecard found a defect in the Stint agent: it read a reasoning model's cut-off reply as done, so nine runs ended without writing a file. It is fixed (D-086), and `bench/scorecard-1/` keeps that run. |
| The daemon, not the agent, says whether it works | Every run ends with the daemon running the tests in the run's worktree. With tests first on, the acceptance tests are written and locked before the build, and a build that edits them is stopped. Live, a control task that cannot pass without editing a locked test stopped red before the gate, with no test edited (`bench/relay/negotiator-control/`). |
| Review costs nothing and needs no network | Muse Glimmer 30B reviews on the laptop through Ollama, at $0.00. A finding that would reverse a recorded decision waits for a person instead of being applied. Review is advice and the tests are the gate: Glimmer approved all 5 failing patches it saw in the live scorecard, and all 9 in the first scorecard. |
| A page is checked by eye, not only by tests | Live, 29 October, through the daemon's own verifier: Muse Spark 1.3 judged a screenshot of a page seeded with the banner "Try again in NaN s." against its criterion and found it wrong, and SAM 3.1 boxed the banner. The verification went red with that reason, for $0.0063 (`bench/visual/result.json`). |
| It learns | A finding that recurs across tasks becomes a skill proposal with evidence, and once a person approves it the next task runs with it (`packages/daemon/test/learn.test.ts`). Live, 27 October, the learned skill's eval on T-0042 found nothing either way: 32 tests passed with it against 31 without, at $0.14 against $0.17. No skill was learned live: on 29 October seven tasks on vercel/ms were each approved with no findings, so nothing recurred and the learn step proposed nothing (`bench/relay/ms-learning/`). |

## The factory around the hand-off

The packet is the core. The rest of Stint is the loop that makes it safe to leave agents running:

- **Verification an agent cannot fake.** The test files a task names are locked at plan time, and held-out scenarios run in a checkout the agent never sees; the Tests tab says "33 passed, tests unchanged, run by Stint". A visual proof opens the page in a browser, Muse Spark judges the screenshot against the person's criterion, and SAM 3.1 marks what looks wrong.
- **Hand-offs that get smarter.** Repeated failure escalates to a stronger model or another agent, and best of n keeps the best green candidate. No model reviews its own work, and review runs per lens.
- **Plans that remember.** The planner reads similar tasks and the decisions on the files it will touch, and splits big tasks into subtasks run in dependency order.
- **A spec from a sentence.** The spec builder drafts a task or a goal in GitHub Spec Kit's shape from a sentence or two, asks only the questions that change what gets built, and keeps the answers as decisions. It also opens an existing Spec Kit spec with no model call.
- **A clear start, and limits you set.** Sharpen asks the few questions whose answers change what gets built, recommends an answer to each, and records yours as decisions every later run keeps. Each task has limits on builds, hand-offs, review rounds, spend and agent time, and autopilot stops and asks before it would pass one. A goal is split into tasks you check first, with limits across all of them, and runs them in order until every criterion is met.
- **How each task went.** Each acceptance criterion reads proven, passing, failing or yours to check, and a passing test proves it only if that test failed before the change. The record adds the loops, the spend and what happened after merge, and a goal rolls up from its tasks.
- **Learning that is measured.** A learned skill starts on probation with an eval with and without it, and is proposed for retirement if it hurts. Golden tasks report pass@1 and pass^3.
- **After merge and at the boundary.** Reverts, follow-ups and failing CI link back to the task. Keys stay in the daemon, the egress proxy denies by default, every change gets a risk tier, and an auto-approve lane must earn its place on a shadow record.
- **Any harness.** Muse Code and the Stint agent run by default. Claude Code, Codex and any Agent Client Protocol agent are config entries, off by default, that all write the same packet; the replay and the live relays turn Claude Code and Codex on, each on a Meta model. `stint mcp install claude` or `stint mcp install codex` gives an agent Stint's tools in one line. A scoreboard can route by results, and OpenTelemetry traces go to any eval tool.

The UI is a calm charcoal workspace that follows the system's light or dark setting, with a shape beside every status word so no state rests on colour. It is tested end to end in a real browser against a live daemon, and every main screen passes an automated WCAG 2.2 AA check in both themes. An adversarial UX audit on 29 October found 18 problems a first-time user would hit and fixed 14 of them, each with a test ([`UX_AUDIT.md`](../UX_AUDIT.md)).

## Real and replayed

`stint demo` replays a recording through the real daemon (real event log, real hash chain, real git commits and merge), so anyone can click through it without keys. The screen says whether a recording was captured from a live run, and when, or hand-written. The default, `demo/recording.jsonl`, is hand-written; the measured numbers above come from live runs ([`proofs.md`](proofs.md)), and `stint demo --live` runs the same script for real. The relays and the scorecard of 29 October ran live on public repositories Stint had never seen, and every run is published, failed ones included ([`proofs.md`](proofs.md#live-evidence-29-october)). `bun run build:judge` builds a read-only copy of the finished replay for GitHub Pages, so a judge can click through it with nothing installed.

## Meta technology, where it is used

| Model | Where it runs | What it does in Stint |
|---|---|---|
| Muse Wonder 1.0 | Meta Model API | plans each task with structured output, asks Sharpen's questions, and writes the statements of the packet quiz |
| Muse Spark 1.3 | Meta Model API, through Muse Code | builds in the task's worktree; Muse Code's JSON event stream becomes the timeline |
| Muse Spark 1.3 | Meta Model API, through the Stint agent | continues from a packet: Stint's own tool-calling agent, with refusals Stint enforces |
| Muse Spark 1.3 | Meta Model API, in the verifier | judges a screenshot of a page against a visual criterion |
| Muse Spark 1.3 | Meta Model API, in the spec builder | drafts a spec from a sentence, with its questions, because a person waits at the dialog (D-089) |
| SAM 3.1 | Meta Model API | marks the element on the screenshot that Muse Spark said is wrong |
| Muse Glimmer 30B | Ollama on the laptop | reviews at $0.00 with the network off, digests a killed run's diff, answers the packet quiz |
| Muse Spark Open | Fireworks, Baseten, Modal | the learn step's first choice, and the fallback for planning, review and the Stint agent when the Meta API or Ollama cannot answer |
| Muse Code plugin hooks | the laptop | draft a packet when context would be lost, and name the step in flight |

By default every model Stint calls at runtime is a Meta model, and the demo uses nothing else. A person can add another agent or model in config; those ship turned off.

## How it is built

A Bun and TypeScript monorepo: a daemon (Hono) that is the only writer of `.stint/`, a hash-chained event log that every view is projected from, adapters that never touch the store, and a React UI the daemon serves. The packet (`stint.handoff/1`) is a published JSON Schema with examples.

## When it was built

[`timeline.md`](timeline.md) lists what was built each day. Part of the scaffold was committed on 26 October before the kickoff session, and the commit history shows the real times.

## Roadmap

- Fine-tune Muse Spark Open on approved packets and skills (Fireworks offers it as a base model).
- Run the factory across machines from the same event log.
- Ship a container image per agent for the docker sandbox.
