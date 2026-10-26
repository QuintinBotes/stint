# Stint: the task outlives the agent

Theme: Push the Frontier, Meta's Muse Spark and Muse Glimmer on a hard problem in software. Track: indie developer.

## Pitch

Coding agents are good at a task until the session ends: the context fills up, the process dies, the rate limit hits, or you want a different agent for the next step. Then the work lives in a transcript nobody can hand on. Stint makes the task, not the chat, the unit of work. The task is a folder in your repository; any agent can pick it up; when a run ends, however it ends, Stint writes a packet of a few hundred tokens that the next agent continues from. Stint runs every agent in its own git worktree, runs the tests itself, reviews offline, and merges only when a person says so. It is a software factory on your own machine, built on Meta's models end to end.

## What it proves

| Claim | Evidence |
|---|---|
| A killed agent's work survives | Muse Code is killed mid-edit with `pkill -9`; the daemon still builds a valid packet from the log and the diff, marks the in-flight step unknown, and a different agent finishes from it. Packet size and tokens: from the live recording. |
| The daemon, not the agent, says whether it works | Every run ends with the daemon running the test command in the run's worktree; the verification card reads "run by the daemon". |
| Review costs nothing and needs no network | Muse Glimmer 30B reviews on the laptop through Ollama with Wi-Fi off, at $0.00; a finding that would reverse a recorded decision goes to a queue instead of being applied. |
| It learns | A finding that recurs across tasks becomes a skill proposal with evidence; once approved, the next task runs with it and the reviewer finds nothing on that point. |
| It is cheap | The whole task, plan to merge, costs under one dollar at list prices; the cost meter prices every run per host, with cached tokens at the cached rate. |

## Real and replayed

`stint demo` replays a recording through the real daemon (real event log, real hash chain, real git commits and merge), so anyone can click through it without keys. The recording says on screen whether it was captured from a live run (and when) or hand-written. `stint demo --live` runs the same script for real.

## Meta technology, where it is used

| Model | Where it runs | What it does in Stint |
|---|---|---|
| Muse Wonder 1.0 | Meta Model API | plans each task with structured output, and writes the statements of the packet quiz |
| Muse Spark 1.3 | Meta Model API, through Muse Code | builds in the task's worktree; Muse Code's JSON event stream becomes the timeline |
| Muse Spark 1.3 | Meta Model API, through the Stint agent | continues from a packet: Stint's own tool-calling agent, with refusals Stint enforces |
| Muse Glimmer 30B | Ollama on the laptop | reviews at $0.00 with the network off, digests a killed run's diff, answers the packet quiz |
| Muse Spark Open | Fireworks, Baseten, Modal | fallback for planning, building and the learn step when the Meta API is busy |
| Muse Code plugin hooks | the laptop | draft a packet when context would be lost, and name the step in flight |

Every model Stint calls at runtime by default is a Meta model, and the demo uses nothing else. A person can add another agent or model in config; those ship turned off.

## How it is built

A Bun and TypeScript monorepo: a daemon (Hono) that is the only writer of `.stint/`, a hash-chained event log that every view is projected from, adapters that never touch the store, and a React UI the daemon serves. The packet (`stint.handoff/1`) is a published JSON Schema with examples.

## When it was built

See `docs/timeline.md`: part of the scaffold was committed on 26 October before the kickoff session, and the history shows the real times.

## Roadmap

Autopilot to the approval gate with hands-off recovery, many tasks in parallel, fine-tuning Muse Spark Open on approved packets and skills (Fireworks offers it as a base model), and more agents behind the same four-method adapter contract.
