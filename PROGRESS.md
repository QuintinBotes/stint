# PROGRESS.md: the ledger

The loop reads this file first and writes it last. Statuses: `todo`, `in_progress`, `handed`, `done`, `blocked`, `cut`. Rows are picked top to bottom; a row is eligible when its Depends on are all `done`. Humans edit Status to `cut`, answer Blocked, and pass Gates. Agents edit everything else.

## Specs

| Spec | Title | Depends on | Status | Owner | Attempts | Updated | Notes |
|---|---|---|---|---|---|---|---|
| F-001 | Demo repo fixture: webhook service with 27 passing tests | none | done | claude-code/claude-opus-5.5 | 1 | 2026-10-26 | Hono webhook service, 27 Vitest tests in 6 files (0.6 s), 14 commits incl. T-0040 merged --no-ff with 4 trailers; shipped as `demo/repo.bundle` + `scripts/fixture.sh`; seed packet in `demo/seed/T-0040/handoff.json` (hash matches the trailer). Left out: nothing. Verify: F-001 block, all exit 0 |
| R-001 | Repo and bootstrap | F-001 | done | claude-code/claude-opus-5.5 | 1 | 2026-10-26 | Workspace, 7 packages with smoke tests, bootstrap (`--check-only`), fixture script, identity guard + test, CI matrix, .env.example. Left out: CI has not run yet because no remote exists (acceptance 2 waits on the first push, a human decision). Verify: R-001 block, all exit 0 |
| R-002 | Core schemas | R-001 | done | claude-code/claude-opus-5.5 | 1 | 2026-10-26 | zod mirrors of all 7 kit schemas + capability + config (with DEFAULT_CONFIG), renderHandoff/parseHandoffPrompt, countTokens (chars/3.6), canonical hash in `@stint-dev/core/node`, 3 handoff examples (killed renders to 412 tokens, 1483 bytes) plus examples for every schema, docs/packet.md, parseSkillFrontmatter. Left out: zod-to-JSON emission (see Deviation; the kit files are published as is and a mutation test proves zod and Ajv agree). Verify: R-002 block, all exit 0 |
| R-003 | File store and event log | R-002 | done | claude-code/claude-opus-5.5 | 1 | 2026-10-26 | Workspace (config defaults, tasks T-00NN, atomic task.json, status events), EventLog (ulid, seq, sha256 chain, per-file queue, O_APPEND, shared instance per path), DecisionLedger (append-only, validTo from supersedes), RunStore/VerificationStore/HandoffStore, taskBundle/costs/latestHandoff, withFixtureRepo(). Left out: `watch` is best-effort fs.watch with no test (the SSE route also polls). Verify: `bun test packages/core` exit 0 |
| R-004 | Daemon routes and SSE | R-003 | done | claude-code/claude-opus-5.5 | 1 | 2026-10-26 | Hono app (health, tasks, events, costs, task SSE with Last-Event-ID resume + 1 s poll fallback + heartbeat, board SSE, direct events, static UI with SPA fallback), bearer token on mutating routes, error shape, per-request JSON log without the token, adapter contract + replay stub, `startDaemon` (127.0.0.1, daemon.json 0600, removed on SIGTERM), `stint up [--port] [--open] [--check]`. Left out: the board stream does not resume (ids are per task; the UI refetches the board on reconnect). Verify: R-004 block, all exit 0 |
| R-005 | Worktree manager and verifier | R-003 | done | claude-code/claude-opus-5.5 | 1 | 2026-10-26 | Worktrees (create on stint/<task> at baseCommit or reuse the branch, refusals dirty_tree/no_commits/path_in_use as run.refused, remove without --force and refusing run_active, diff unified/json, live snapshots every 5 s into file.changed, wip commit), DaemonVerifier (process group, 10 min cap, Vitest and bun test parsing, exit-code fallback, verification/<run>.json + output file, verification.ran), RunRegistry, runEnv, POST /verify, GET /diff. Left out: nothing. Verify: `bun test packages/daemon` exit 0 |
| R-006 | Replay format and replayer | R-004 | todo | | 0 | | |
| R-007 | Web UI shell | R-004, R-006 | todo | | 0 | | |
| R-008 | PTY and terminal pane | R-004, R-005 | todo | | 0 | | cut order 3 |
| R-009 | Muse Code adapter (implement) | R-004, R-005 | todo | | 0 | | |
| R-010 | OpenAI-compatible planner and reviewer | R-002 | todo | | 0 | | |
| R-011 | Cost meter | R-009, R-010 | todo | | 0 | | |
| R-012 | Handoff builder | R-003, R-005, R-009 | todo | | 0 | | never cut |
| R-013 | Claude Code adapter (continue) | R-012 | todo | | 0 | | never cut |
| R-014 | Muse hooks and AGENTS.md section | R-004, R-012 | todo | | 0 | | |
| R-015 | Timeline and diff | R-006, R-007 | todo | | 0 | | |
| R-016 | Cards and the approval gate | R-012, R-015 | todo | | 0 | | |
| R-017 | Approve, merge, trailers | R-005, R-012 | todo | | 0 | | |
| R-018 | Memory graph projection | R-003, R-017 | todo | | 0 | | |
| R-019 | Memory panel and time scrubber | R-007, R-018 | todo | | 0 | | cut order 2 |
| R-020 | Learn step and skills registry | R-010, R-017, R-018 | todo | | 0 | | cut order 4 |
| R-021 | Bench | R-009, R-012, R-013 | todo | | 0 | | cut order 1 |
| R-022 | Demo seeding and recording | R-006, R-020 | todo | | 0 | | |
| R-023 | Rehearsal, video, docs | R-022 | todo | | 0 | | docs by agents, video by human |
| R-024 | Buffer and submit | R-023 | todo | | 0 | | human |

## Gates

| Gate | After | Status | By | When | Note |
|---|---|---|---|---|---|
| 1 | R-008 | pending | | | replay plays end to end with no keys |
| 2 | R-014 | pending | | | live Muse Code to Claude Code handoff passes verification |
| 3 | R-019 | pending | | | full live demo incl. offline review and approve |
| 4 | R-023 | pending | | | video recorded, repo public-ready |

## Decisions (append-only; D-001 upward; a reversal is a new line with supersedes)

| Id | When | By | Decision | Why |
|---|---|---|---|---|
| D-001 | 2026-10-21 | Quintin | Project name is Stint; folder `.stint/`, branch prefix `stint/`, trailer `Stint-Task`, binary `stint` | Rift is a Meta trademark and an existing CLI; Baton collides twice |
| D-002 | 2026-10-21 | Quintin | npm scope `@stint-dev` (confirm after the org is created) | bare `stint` is taken by a 2015 package |
| D-003 | 2026-10-21 | Quintin | Dark is the default theme; light and stage opt-in | presentation and daily use are both dark |
| D-004 | 2026-10-21 | Quintin | Stint never emits OSC 7373 and sets `TERM_PROGRAM=Stint` | an earlier terminal project on the same machine claims panes by that OSC |
| D-005 | 2026-10-21 | Quintin | Verification is run by the daemon only; adapters never report test results as truth | the honesty claim of the product |
| D-006 | 2026-10-26 | Quintin | Muse Spark Open runs hosted on Baseten (`meta-models/muse-spark-open`, 2M TPM, $100 credits) and Fireworks (`accounts/fireworks/models/muse-spark-open`, enforced json_schema, cached input, $25 credits) through the one OpenAI-compatible adapter; roles walk fallback chains (planner, reviewer, learn, summary); the stage review stays on Ollama | Meta lists both as Spark Open hosting partners; both are hackathon partners; a 429 on the Meta API must never stop a task |
| D-007 | 2026-10-26 | claude-code | The fixture ships as a git bundle `demo/repo.bundle`; `bun run fixture` clones it to `demo/repo` (gitignored) and tests clone it to a temp dir | a nested `.git` inside the repo becomes a gitlink and breaks clones; F-001 allows a packed fixture plus an unpack script |
| D-008 | 2026-10-26 | claude-code | Workspaces are `packages/*`, `packages/adapters/*`, `apps/*` | the adapters live one level deeper than `packages/*` reaches |
| D-009 | 2026-10-26 | claude-code | Build routing: Claude Code (this session) orchestrates, writes the foundation specs owned CC, and reviews every spec; Muse Code on `muse-wonder-full-1.0` builds the specs owned MC in its own worktree; Codex only for an independent review of R-012 and R-017 | spend the free credits first: Meta Model API ($150) carries Muse Code; Claude is the user's subscription; partner credits are kept for the product's hosted legs, rehearsals and the bench |
| D-010 | 2026-10-26 | claude-code | Runtime spend order per role: free local Glimmer where the role allows, then the Meta API credits, then Fireworks, Baseten and Modal partner credits; the chains in AGENTS.md section 6 stay, with `modal` appended as the last hosted Spark Open entry | the user asked to use the free tokens first; Modal offers $100 for Meta open weights and serves Muse Spark Open at the same list price |
| D-011 | 2026-10-26 | claude-code | Commits use the repo-local identity `QuintinBotes <id+QuintinBotes@users.noreply.github.com>` | the global git email is a real address; non-negotiable 9 |
| D-012 | 2026-10-26 | claude-code | Cost semantics: `inputTokens` counts every prompt token including cached ones, `cachedTokens` is that cached subset, price = (input minus cached) x input rate + cached x cached rate + output x output rate | it is what Muse Code `run.usage` (input 91544, cached 60648) and OpenAI-style `prompt_tokens` report |
| D-013 | 2026-10-26 | claude-code | Run ids: r1 planner, r2 Muse Code implementer (killed), r3 Claude Code continue, r4 Glimmer review | R-002, R-006, R-012, R-017 and R-022 agree on this; R-015's "r1 Muse, r2 Claude" labels are loose |
| D-014 | 2026-10-26 | claude-code | Dependencies outside the pin table: `ajv` 8.20.0 and `ajv-formats` 3.0.1 (core dev, the contract tests), `@vitejs/plugin-react` 5.2.0 and `@types/react(-dom)` 19.3.0 (web build) | Ajv is how the kit schemas are checked; the React plugin and types are what Vite 7 and React 19 need |
| D-015 | 2026-10-26 | claude-code | `@stint-dev/core` has two entries: `.` (browser-safe schemas, render, tokens) and `./node` (hashing, and from R-003 the file store) | the web UI imports core; Vite cannot bundle `node:crypto` or `node:fs` |
| D-016 | 2026-10-26 | claude-code | A new worktree with a `bun.lock` and no `node_modules` gets `bun install --frozen-lockfile` before the run | without dependencies neither the agent nor the daemon's verifier can run the tests |
| D-017 | 2026-10-26 | claude-code | The dirty-tree check ignores `.stint/` and untracked files | the daemon itself writes `.stint/`; a repo that tracks its own `.stint/` (this one) would otherwise never be clean |

## Deviations (a spec line not followed, with the reason; the human decides whether the spec changes)

| Spec | Line | What was done instead | Why | Decided |
|---|---|---|---|---|
| R-001 | Req 1, `"workspaces": ["packages/*", "apps/*"]` | added `packages/adapters/*` | see D-008 | pending |
| R-001 | Req 4, email allowlist | also allow `@users.noreply.github.com`; the email rule skips `specs/` and the guard's own test | GitHub noreply addresses are the handle-only identity; `specs/R-001` and its test quote the guard test's sample gmail address | pending |
| F-001 | Context, nested repo | git bundle instead of a tarball | see D-007 | pending |
| R-002 | Req 6, emit the JSON Schemas from zod and deep-equal the kit | `build:schemas` publishes the kit files into `packages/core/schemas`; `test/schemas.agree.test.ts` proves zod and Ajv agree on every example and on roughly 1,800 field mutations | zod 4 output differs in shape (`type` beside `const`, `anyOf` for null, a datetime `pattern`) and cannot express the kit's `if/then`; LOOP says `schemas/` wins on conflict | pending |
| R-002 | `schemas/handoff.schema.json` `from.host` enum | added `modal` | D-010; R-002 owns the schemas | pending |
| R-002 | Kit refs `handoff.schema.json#/$defs/cost` in event and review | tests register the handoff schema at the two URLs those refs resolve to | the relative ref resolves against `.../event/1`, not `.../handoff/1`; the schema files are unchanged | pending |

## Reviews

| Spec | Attempt | Verdict | Reviewer | Findings | File |
|---|---|---|---|---|---|

## Blocked (questions for the human; the loop stops on a new row here)

| When | Spec | Question | Answer |
|---|---|---|---|
| 2026-10-26 | R-001 | Human to-do: create the GitHub repo (public now or at submission; public gets free macOS CI minutes) and allow the first push, so CI can prove acceptance 2 | |
| 2026-10-26 | R-013 | Human to-do: read Discord `#rules`; does a non-Meta model (Claude Code) in the continue hop comply? If not, the second Muse Code run takes that beat (AGENTS.md section 8) | |
| 2026-10-26 | R-023 | Human to-do: read the IP clause and choose the licence; choose the track (indie or startup); add the employer name to `scripts/guard-identity.denylist` | |
| 2026-10-26 | R-010 | Human to-do, not a loop blocker: claim the partner credits (Baseten $100 + 2M TPM, Fireworks $25, Modal $100) through the hackathon's partner links, create API keys in the `stint` Baseten org and the Fireworks account, export `BASETEN_API_KEY` and `FIREWORKS_API_KEY` on the demo laptop, and enter the balances in `config.credits` | human, in progress; the loop continues (hosts without a key show unavailable until then) |

## Ideas (out of scope, not for this build)

- 

## Spend (one line per iteration; `scripts/loop.sh` appends)

| When | Spec | Agent | Tokens in/out | USD | Wall |
|---|---|---|---|---|---|
