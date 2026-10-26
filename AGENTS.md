# Stint: the brief for every agent working in this repo

You are building **Stint**, a local-first control plane for AI-built software where the task, not the chat, is the unit of work. One line: **the task outlives the agent.** This file is read by Muse Code, Claude Code and any other agent that opens the repo. Read it fully before touching a file. The build is spec-driven and runs in a loop: `LOOP.md` is your iteration prompt, `GOAL.md` is what "done" means, `PROGRESS.md` is the ledger, `specs/` holds one spec per task, `schemas/` holds the contracts.

## 1. What Stint is

A plain-file task workspace in the repo (`.stint/`) that any coding agent can pick up; a daemon (Bun + Hono) that runs each agent in its own git worktree and verifies the result itself; a structured handoff packet (`stint.handoff/1`) that carries a task between vendors in a few hundred tokens; a memory derived from the event log that can be scrubbed through time; and a learn step that proposes a skill from outcomes and puts it in the same approval queue as code.

Three layers, one product:

| Layer | What it is | What the user sees |
|---|---|---|
| Task and handoff | `.stint/tasks/<id>/` as source of truth; the packet; a four-method adapter contract; Muse Code, Claude Code and Ollama adapters; worktree per run; the daemon as the only writer | One timeline per task, a segment per run coloured by vendor; the handoff card; a real `git diff`; a verification card the daemon fills |
| The factory | States planned, building, verifying, reviewing, awaiting_approval, approved, rejected, done, abandoned, enforced by the daemon; budgets per role; a learn step | A board by state with a "Needs you" lane first; a cost meter on every run; a skill proposal with evidence; the next task running with that skill |
| The memory | A bitemporal graph projected from `events.jsonl` and `decisions.md`; three queries; an adjudication queue | A memory panel with a time scrubber; "why is this code like this" answered with the decision and the run |

What it is **not**: not a chat UI, not an agent framework, not a model router, not an issue tracker, not hosted, not "run N agents at once". It sits above those tools and makes them interchangeable.

## 2. The demo this build exists for (4 November)

One task, four agents, three vendors, one timeline, three survivals. Every spec serves one of these beats; if a change does not serve a beat, it waits.

| Time | Beat | Proof on screen |
|---|---|---|
| 0:00 | The folder is the task | Board with four tasks; Finder on `.stint/tasks/T-0042/` |
| 0:12 | Speak the task; Wonder plans | Voice to `task.json`; plan streams in; memory shows T-0040 as similar |
| 0:40 | Muse Code builds | Worktree, live diff, cost meter, decision D3 lands in `decisions.md` |
| 1:05 | **Kill it** | `pkill -9 muse` in the terminal pane; segment goes amber; a packet appears anyway: 1.4 KB, 412 tokens, in-flight step marked unknown |
| 1:20 | **A different vendor finishes** | Claude Code continues from the packet; daemon verifies: 33 passed |
| 1:45 | **Review offline** | Wi-Fi off; Glimmer 30B reviews at $0.00; a finding that contradicts D3 is routed to the queue, the human decision stands |
| 2:05 | Approve and merge | Gate opens only on green verify; one commit with `Stint-Task: T-0042` |
| 2:15 | **It learned** | Learn step proposes `limiter-config-via-env` with evidence; approve; T-0043 runs with it mounted; zero findings on what was flagged before |
| 2:35 | Close | Task total under $1; the time scrubber; "We make one task survive anything." |

The UI is built against a recorded replay (`demo/recording.jsonl`) from day 2, before any API key exists. Everything a judge clicks must work without keys.

## 3. Non-negotiables

These hold in every file you write. A spec cannot override them; a `Deviation:` note in `PROGRESS.md` is the only way to bend one, and a human decides.

1. **The daemon is the only writer of `.stint/`.** Adapters, the CLI and the UI never touch it directly. `.stint/` must be readable without Stint: plain JSON, JSONL and markdown.
2. **Packets, never transcripts.** The next agent receives `prompt.md` = rendered packet + plan + skills list + diff. `transcript.jsonl` is for audit and is never fed to an adapter.
3. **Verification runs in the daemon**, in the worktree, after every run, with `task.testCommand`. An agent's "tests pass" is a claim; `verification/<run>.json` is the record. Review is offered only after a green verify.
4. **Every ending builds a packet.** `completed`, `capped`, `killed`, `failed` and `handed` all produce `handoff.json`. There is no state without a packet. `leftOut` and `askOfNext` are required; `leftOut` may be empty but must be present.
5. **Capability honesty.** An adapter reports `Supported`, `Partial` (with a note), `Unsupported` (with a reason) or `Unknown`, and a permission gate is **observed** (classified but not preventable) until a gate has actually fired. The UI says "observed" for Muse Code and Ollama until proven otherwise. No `bypassPermissions` mode is ever offered. Never claim a capability the code has not proven.
6. **Fail open loudly.** Any check that cannot run says so on stderr and in the timeline: "This tool call was NOT checked against Stint rules." Never pretend a check ran.
7. **Decisions are append-only.** A reversal is a new `decisions.md` entry with `supersedes:`. A reviewer's finding never overrules a human-asserted decision; a contradiction goes to the queue.
8. **Secrets never enter the repo or a packet.** API keys live in the environment only. The packet reads command excerpts, never tool-output summaries; a test proves a credential in tool output never reaches `handoff.json`.
9. **Nothing identifies the author** beyond the GitHub handle: no real email, no em dashes in source or docs, no hard-coded reviewer name. `scripts/guard-identity.mjs` fails CI on any of these. No client material and no employer-internal platform names anywhere.
10. **Pins are law.** Versions in section 6 are the only versions; adding a dependency needs a `Decision:` line in `PROGRESS.md` with the reason.
11. **Dark is the default theme.** `light` and `stage` are opt-in. The CLI's colours and the demo recording are dark.
12. **Words, not decoration.** Sentence case, plain words, present tense, no emoji in UI or CLI output, no gradients, no icons where a word does. Honest copy: "run by the daemon", "in-flight step unknown", "replay of a live run on 2 Nov".

## 4. Architecture and repo layout

Clients (web UI, CLI, Muse Code hooks) talk to the daemon over localhost only. The daemon alone writes `.stint/`, starts adapters inside a per-run worktree, re-runs the tests itself, and projects the timeline, the packet, the costs and the memory graph from `events.jsonl`. Adapters never touch the store, which is what makes a new agent one file.

```
stint/
  package.json                 bun workspaces: packages/*, apps/*
  bunfig.toml
  packages/
    core/                      zod schemas, file store, event log, graph projection      @stint-dev/core
      schemas/handoff.schema.json   the published spec + examples/
    daemon/                    Hono app: routes, SSE, worktrees, verifier, costs, pty, learn   @stint-dev/daemon
    adapters/
      muse-code/               exec --json mapper, schema-generated types, hooks template      @stint-dev/adapter-muse-code
      claude-code/             Agent SDK query() wrapper                                        @stint-dev/adapter-claude-code
      openai-compatible/       plan/review client for Meta API and Ollama                       @stint-dev/adapter-openai-compatible
    cli/                       `stint` commands (citty), --json everywhere                      @stint-dev/cli, bin: stint
  apps/
    web/                       React 19 + Vite 7 + Tailwind 4 + shadcn/ui; served by the daemon
  demo/
    repo/                      the webhook service fixture with 27 passing tests (own git history)
    recording.jsonl            the replay
  bench/                       stint bench harness and results
  docs/                        packet.md, adapters.md, support matrix
  specs/ schemas/ PROGRESS.md GOAL.md LOOP.md REVIEW.md AGENTS.md
  scripts/                     bootstrap.sh, loop.sh, gate.sh, guard-identity.mjs
  .github/workflows/ci.yml     ubuntu-latest + macos-latest
```

Package scope: `@stint-dev` (the bare `stint` name on npm is taken by a 2015 package; the binary is still `stint`).

## 5. Data formats, in one page

Everything lives under `.stint/` in the repo. Full JSON Schemas are in `schemas/`; they are the contract and every test validates against them.

```
.stint/
  config.json                  adapters, models, per-role budgets, default testCommand, port/token file
  tasks/T-0042-rate-limit-webhooks/
    task.json                  stint.task/1: goal, acceptance[], status, baseCommit, branch, assignee, testCommand, budgets
    plan.json                  stint.plan/1: steps[], filesToTouch[], risks[], similarTasks[], model
    decisions.md               append-only: "## D3 · <ts> · <adapter> <run>" + text + supersedes: + evidence:
    context.json               relevant files with line ranges, links, similar past tasks
    handoff.json               latest packet; handoffs/h1.json … keep every packet
    review.json                stint.review/1; reviews/ keeps all
    events.jsonl               the timeline, append-only, one JSON object per line, seq monotonic
    runs/r2-muse-code-implementer/{meta.json, prompt.md, transcript.jsonl}
    verification/r2.json       command, exitCode, passed, failed, durationMs, runBy: "daemon"
  worktrees/                   gitignored; T-0042-r2/ is a git worktree on branch stint/T-0042
  cache/                       gitignored; daemon.json (port, token), graph.sqlite, proposals/; always rebuildable
.agents/skills/<id>/SKILL.md   skills live where Muse Code, Claude Code and Codex already look
AGENTS.md                      this file; `stint init` adds a "## Stint" section pointing at the active task
```

**Task status** is one of `planned`, `building`, `verifying`, `reviewing`, `awaiting_approval`, `approved`, `rejected`, `done`, `abandoned`.

**The packet** (`stint.handoff/1`): `version, task, from{adapter,vendor,model,host?,role,run,endedBy}, to{adapter,role}, summary (≤400 chars), done[], open[], leftOut[] (required), decisions[{id,text}], risks[], changedFiles[{path,added,removed}], diffRef{base,head}, verification{command,exitCode,passed,failed,durationMs,runBy}, askOfNext (required, non-empty), cost{inputTokens,cachedTokens,outputTokens,usd}, createdAt, hash`. Array strings ≤200 chars. `endedBy` ∈ completed, capped, killed, failed, handed. The whole file renders under 600 tokens. `toPrompt()` renders it with fixed headings the next hop can parse back by exact string: `## The task`, `## Where it got to`, `## Done`, `## Open`, `## Refused actions`, `## Decisions`, `## Risks`, `## Ask of next`, `## Not included`.

**Events** (`events.jsonl`), each line `{ id: ulid, seq, ts, task, run?, adapter?, type, payload, raw?: {kind, pointer, byteLen, redacted}, links?: [] }`. Types: `task.created`, `task.status`, `run.started`, `run.finished`, `run.refused`, `agent.message`, `agent.tool_call`, `agent.tool_result`, `human.command`, `file.changed`, `decision.recorded`, `verification.ran`, `review.recorded`, `handoff.created`, `approval.requested`, `approval.granted`, `approval.rejected`, `skill.applied`, `skill.proposed`, `skill.approved`, `skill.rejected`, `merge.completed`, `runtime.unclassified`. Unknown adapter output is kept as `runtime.unclassified`, never dropped. Each row carries `prev` and `hash` (SHA-256 over the canonical fields plus the previous hash) once R-003's chain lands; `stint verify` names the first broken row.

**Plan, review, skill proposal**: see `schemas/plan.schema.json`, `schemas/review.schema.json`, `schemas/skill-proposal.schema.json`. `review.verdict` ∈ approve, request_changes, block; finding `severity` ∈ blocker, major, minor, note; a finding may carry `contradictsDecision: "D3"`.

## 6. Stack and pins

| Tool | Pin | Note |
|---|---|---|
| Bun | ≥ 1.3.14 | `Bun.Terminal` for the PTY; `bun test` everywhere |
| TypeScript | 5.x strict, `noUncheckedIndexedAccess` | |
| Hono | 4.x | REST + SSE + static `apps/web/dist` |
| zod | 4.x | schemas are the spec; `zod-to-json-schema` emits `handoff.schema.json` |
| citty | latest | CLI |
| React 19, Vite 7, Tailwind 4 | latest | shadcn/ui copied in, Base UI, Rhea style |
| shadcn AI Elements, Kibo UI Kanban, `@pierre/diffs` 1.5.x, shiki 4.x, `@xterm/xterm` 6.x + fit + webgl, dnd-kit, cmdk, react-resizable-panels, sonner, recharts, react-json-view-lite, lucide-react, Geist | latest at kickoff | UI only |
| `@anthropic-ai/claude-agent-sdk` | ≥ 0.3.296 | V1 `query()` |
| `@muse-code/sdk` | exact version at kickoff | behind the `muse exec --json` path |
| `openai` | 5.x | one client for every OpenAI-compatible host: Meta Model API, Baseten, Fireworks, Ollama |
| Ollama | ≥ 0.32.8 | `muse-glimmer:30b-mlx` |
| Vitest | demo repo only | the daemon parses its summary line |

**Hosts** (a provider is a base URL and a key name, never a code path; all four go through `@stint-dev/adapter-openai-compatible`):

| Host id | Base URL | Key | Models | Notes |
|---|---|---|---|---|
| `meta-api` | Meta Model API | `META_API_KEY` | `muse-wonder-1.0`, `muse-spark-1.3` | the hero models; native structured output |
| `baseten` | `https://inference.baseten.co/v1` | `BASETEN_API_KEY` | `meta-models/muse-spark-open` | Meta's open-weight 816B model hosted; $1.25 in, $0.15 cached, $4.25 out per M; hackathon partner: $100 credits and 2M TPM; accepts `json_schema` but does not enforce it, so the adapter validates and retries |
| `fireworks` | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` | `accounts/fireworks/models/muse-spark-open` | same model and prices, cached input $0.15, enforced `json_schema`, function calling, zero data retention, US-only serverless; hackathon partner: $25 credits |
| `ollama` | `http://localhost:11434/v1` | none | `muse-glimmer:30b-mlx` | offline, $0, the review beat on stage |

Models by role, as fallback chains the daemon walks in order (a 429, a 5xx or a missing key moves to the next host and emits `provider.fallback`): planner `meta-api/muse-wonder-1.0` → `fireworks/muse-spark-open` → `baseten/muse-spark-open` → `ollama/glimmer`; implementer Muse Code on `muse-spark-1.3`, Claude Code for the continue hop; reviewer `ollama/glimmer` (offline by design on stage) → `fireworks/muse-spark-open` → `baseten/muse-spark-open`; learn `baseten/muse-spark-open` → `meta-api/muse-spark-1.3` → `ollama/glimmer`; bench legs and bulk summaries `baseten/muse-spark-open` (the 2M TPM) with local Glimmer for per-event summaries. Caps: planner 40k tokens / 1 call; implementer 150k tokens, `--max-model-steps 60`, 15 min; reviewer 30k; learn 20k. Every run records which host answered (`from.host`), and the cost meter prices by host.

## 7. How to work here

- **One spec per iteration.** `LOOP.md` tells you how to pick it, build it, verify it and record it. Never work on two specs at once; never start a spec whose `Depends on` is not `done`.
- **Tests first.** Turn each acceptance criterion into a test before writing the code it tests. `bun test` and `bun run typecheck` must be green before a spec is `done`; CI (ubuntu + macos) must be green before a gate.
- **Small, named commits.** `R-0xx: <what>` with trailers `Spec: R-0xx` and `Model: <adapter/model>`. From R-017 on, Stint's own merges carry `Stint-Task:` trailers too (the repo builds itself with itself).
- **Record, don't remember.** Every decision goes into `PROGRESS.md` under Decisions with a reason; every deviation from a spec gets a `Deviation:` line; every question for the human goes under Blocked.
- **Hand off like the product does.** If you stop before a spec is green, leave a handoff note in `PROGRESS.md` in packet shape (done, open, leftOut, risks, askOfNext, ≤ 600 tokens) and set the status to `handed`. The next iteration, possibly another vendor, continues from that note and the worktree, not from your transcript.
- **Do not touch**: `specs/` (except a `Deviation:` note), `schemas/` (except through the spec that owns a schema), `demo/repo` history, pins, CI matrix, licence, anything under `.stint/` by hand.
- **Ask when a decision cannot be undone** and could go either way: licence, a public package name, deleting history, anything touching the hackathon rules. Write it under Blocked and stop.

## 8. Hackathon constraints

- Product code is written from **26 October** onward. Research, design, schemas, specs, this kit and the demo fixture precede it; that is allowed.
- Meta models are used in the roles Meta documents: Wonder plans, Spark builds (Muse Code), Glimmer reviews, and Muse Spark Open (Meta's open-weight model) plans, reviews and learns on the two hosts Meta's own deployment page lists, Baseten and Fireworks. The Claude hop is one adapter and swappable: if the rules forbid it, a second Muse Code run on another model takes the continue beat.
- Open source, public repo, 3-minute video, teams of two at most. Licence decided after the IP clause is read on 26 October; until then no `LICENSE` file.
- `Built with Muse Spark Open` attribution is required, since hosted Spark Open legs are part of the product. Keys never in the repo. Nothing from the author's employer or clients.
- Hackathon partner credits (Baseten $100 and 2M TPM, Fireworks $25, Modal $100) are claimed by the human before day 3 and recorded in `PROGRESS.md`; the cost meter's "credits left" starts from those figures.

## 9. Glossary

**Task** a unit of work with a goal and acceptance criteria, in `.stint/tasks/`. **Run** (also stint) one agent working one task in one worktree, `r1`, `r2`, … **Packet** the handoff record, `h1`, `h2`, … **Hop** a run handed to another agent. **Gate** the approval stop before merge; also the four go/no-go days in the build plan. **Verify** the daemon running `testCommand`. **Finding** a review item. **Decision** a `decisions.md` entry, `D1`, `D2`, … **Skill** a `SKILL.md` folder under `.agents/skills`. **Observed** classified but not preventable. **Replay** `demo/recording.jsonl` played through the daemon.
