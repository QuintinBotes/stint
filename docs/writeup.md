# Stint: the task outlives the agent

The submission write-up for the Meta Global AI Developer Hackathon, for the judges. Theme: Push the Frontier, Meta's Muse Spark and Muse Glimmer on a hard problem in software. Track: indie developer.

## Pitch

Coding agents are good at a task until the session ends: the context fills up, the process dies, the rate limit hits, or you want a different agent for the next step. Then the work lives in a transcript nobody can hand on. Stint makes the task, not the chat, the unit of work. The task is a folder in your repository that any agent can pick up. When a run ends, however it ends, Stint writes a packet of a few hundred tokens that the next agent continues from. Stint runs every agent in its own git worktree, runs the tests itself, reviews offline, and merges only when a person says so. It is a software factory on your own machine, built on Meta's models end to end.

## Who it is for

- **Developers who already use a coding agent and lose work when its session ends.** That happens when the context fills, the rate limit hits, the process dies, or they want another agent for the next step.
- **Small teams that want agents to work in parallel without losing track.** Every task's history is an event log in the repository, every merge says which task, runs and packet it came from, and decisions are protected from being silently reversed.
- **Anyone who cannot send code to a cloud reviewer.** The review runs on the laptop.

## What it proves

| Claim | Evidence |
|---|---|
| A killed agent's work survives | Live, 26 October: Muse Code was killed mid-task on T-0042. The daemon built the packet from the log and the diff alone, and the Stint agent continued from it on Muse Spark 1.3. The daemon's test run passed 29 of 29, and the continued run cost $0.10. |
| The packet is enough, and we measured it | `stint bench`, five live tasks on the current build: the packet is about 925 tokens against 6,328 for the transcript, and 9 of 10 continued runs from it passed against 3 of 5 from the transcript, with 31% fewer input tokens at 11% less cost. On the first run, on 26 October, both passed 5 of 5 but the packet cost about the same, because the agent re-read code. The packet quiz found the gap, so the packet now carries the leaving agent's own account of what the code does, or a digest of the diff when the agent cannot be asked. |
| The daemon, not the agent, says whether it works | Every run ends with the daemon running the tests in the run's worktree. With tests first on, the acceptance tests are written and locked before the build, and a build that edits them is stopped. |
| Review costs nothing and needs no network | Muse Glimmer 30B reviews on the laptop through Ollama, at $0.00. A finding that would reverse a recorded decision waits for a person instead of being applied. |
| It learns | A finding that recurs across tasks becomes a skill proposal with evidence, and once a person approves it the next task runs with it (`packages/daemon/test/learn.test.ts`). Live on 27 October, the learned skill's eval on T-0042 found nothing either way, with 32 tests passing with it against 31 without, at $0.14 against $0.17. |

## The factory around the hand-off

The packet is the core; the rest of Stint is the loop that makes it safe to leave agents running:

- **Verification an agent cannot fake.** The test files a task names are locked at plan time, and held-out scenarios run in a checkout the agent never sees. The Tests tab says "33 passed, tests unchanged, run by Stint".
- **Hand-offs that get smarter.** Repeated failure escalates to a stronger model or another agent. Best of n keeps the best green candidate. No model reviews its own work, and review runs per lens.
- **Plans that remember.** The planner reads similar tasks and the decisions on the files it will touch, and splits big tasks into subtasks run in dependency order.
- **A clear start, and limits you set.** Before work starts, Sharpen asks the few questions whose answers change what gets built, recommends an answer to each, and records yours as decisions every later run keeps. Each task has limits on builds, hand-offs, review rounds, spend and agent time, and autopilot stops and asks before it would pass one. A goal above tasks is split into tasks you check first, with limits across all of them.
- **How each task went.** Each acceptance criterion reads proven, passing, failing or yours to check, and a passing test proves it only if that test failed before the change. The record adds the loops, the spend and what happened after merge, and a goal rolls up from its tasks.
- **Learning that is measured.** A learned skill starts on probation with an eval with and without it, and is proposed for retirement if it hurts. Golden tasks report pass@1 and pass^3.
- **After merge and at the boundary.** Reverts, follow-ups and failing CI are linked back to the task. Keys stay in the daemon, egress is default-deny, every change gets a risk tier, and an auto-approve lane must earn its place on a shadow record.
- **Any harness.** Muse Code and the Stint agent by default. Claude Code, Codex and any Agent Client Protocol agent are off-by-default config entries, all writing the same packet. A scoreboard can route by results, and OpenTelemetry traces go to any eval tool.

The UI is tested end to end in a real browser against a live daemon, and every main screen passes an automated WCAG 2.2 AA check.

## Real and replayed

`stint demo` replays a recording through the real daemon (real event log, real hash chain, real git commits and merge), so anyone can click through it without keys. The recording says on screen whether it was captured from a live run (and when) or hand-written; the default one, `demo/recording.jsonl`, is hand-written, and the measured numbers above come from live runs ([`proofs.md`](proofs.md)). `stint demo --live` runs the same script for real.

## Meta technology, where it is used

| Model | Where it runs | What it does in Stint |
|---|---|---|
| Muse Wonder 1.0 | Meta Model API | plans each task with structured output, and writes the statements of the packet quiz |
| Muse Spark 1.3 | Meta Model API, through Muse Code | builds in the task's worktree; Muse Code's JSON event stream becomes the timeline |
| Muse Spark 1.3 | Meta Model API, through the Stint agent | continues from a packet: Stint's own tool-calling agent, with refusals Stint enforces |
| Muse Glimmer 30B | Ollama on the laptop | reviews at $0.00 with the network off, digests a killed run's diff, answers the packet quiz |
| Muse Spark Open | Fireworks, Baseten, Modal | the learn step's first choice, and the fallback for planning, review and the Stint agent when the Meta API or Ollama cannot answer |
| Muse Code plugin hooks | the laptop | draft a packet when context would be lost, and name the step in flight |

Every model Stint calls at runtime by default is a Meta model, and the demo uses nothing else. A person can add another agent or model in config; those ship turned off.

## How it is built

A Bun and TypeScript monorepo: a daemon (Hono) that is the only writer of `.stint/`, a hash-chained event log that every view is projected from, adapters that never touch the store, and a React UI the daemon serves. The packet (`stint.handoff/1`) is a published JSON Schema with examples.

## When it was built

See [`timeline.md`](timeline.md): part of the scaffold was committed on 26 October before the kickoff session, and the history shows the real times.

## Roadmap

Fine-tuning Muse Spark Open on approved packets and skills (Fireworks offers it as a base model), running the factory across machines from the same event log, and container images per agent for the docker sandbox.
