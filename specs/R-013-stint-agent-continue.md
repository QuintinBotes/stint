# R-013 · Stint agent (continue)

Day: 4 (30 Oct) · Owner: Q · Depends on: R-012 · Fallback: a replay of the recorded continue run, or a second Muse Code run on `muse-wonder-1.0` · Cut: NEVER (the pitch)

## Goal
A different agent finishes the task from the packet alone. Stint's own coding agent is a small tool-calling loop on a Meta model through any OpenAI-compatible host (Muse Spark 1.3 on the Meta Model API by default; Muse Spark Open on Fireworks, Baseten or Modal down the same chain the planner walks). It reads `prompt.md` (packet, plan, skills, diff), checks the unknown step first so nothing is done twice, completes the open items, and the daemon's verify goes green. Because Stint executes every tool call itself, this is the one adapter whose permission gate can refuse a call: enforced, not observed.

## Context
Every model Stint calls at runtime is a Meta model (D-018). The Meta Model API answers OpenAI-style tool calls (probed 26 Oct: `muse-spark-1.3` and `muse-spark-1.2` both return `tool_calls`, with `prompt_tokens_details.cached_tokens` in usage). `openai` 5.x is the one client for every host (R-010). Adapters never touch `.stint/` (AGENTS.md section 3).

## Requirements
1. MUST implement `packages/adapters/stint-agent/src/index.ts` exporting `stintAgentAdapter: Adapter` with `id: 'stint-agent'`, `vendor: 'meta'`, `roles: ['implementer', 'reviewer']`, capabilities `{ editsFiles: true, runsCommands: true, resumable: false, structuredOutput: true, offline: false }`, `available()` (a key for at least one host in its chain, or Ollama reachable), and `gate: 'enforced'` once a refusal has actually fired in this daemon lifetime (`observed` before that).
2. MUST implement `run()`: chat completions with the tools `read_file`, `write_file`, `edit_file` (exact string replace), `list_dir`, `grep`, `bash` (in the worktree, own process group, 120 s cap, output capped at 8 KB), each call checked by the refusal set before it runs; map assistant text to `agent.message`, each call to `agent.tool_call` with its arguments (so an in-flight step is always named), each result to `agent.tool_result` (bodies truncated in the event, kept in the transcript); end `completed` on a final answer with no tool calls, `capped` on `maxTurns` or the token budget, `killed` on abort, `failed` on an error no host could answer; sum usage over every response into `cost`.
3. MUST implement the refusal set: a path outside the worktree, `git push`, `git reset --hard`, `git checkout` of another branch, `rm -rf` outside the worktree, uploads (`curl -T`, `scp`, `rsync` to a host) and credential paths (`.env`, `~/.ssh`, `~/.aws`); a refused call is emitted as `rule.blocked` with the reason and returned to the model as the tool result, so it can carry on.
4. MUST walk its host chain (`meta-api/muse-spark-1.3`, then `fireworks/muse-spark-open`, `baseten/muse-spark-open`, `modal/muse-spark-open`): a missing key, a 429, a 5xx or a timeout moves to the next host and emits `provider.fallback`; the run records the host that answered last.
5. MUST keep the "no duplicate work" check: `renderPrompt` places the unknown-step line first under `## Ask of next`, and the live test asserts the continue run does not re-create files the packet lists under `done`.
6. MUST provide a replay twin: `packages/adapters/stint-agent/test/fixtures/continue-run.jsonl` captured from the real continue on the fixture, and a test that replays it through the mapper.
7. SHOULD price cached tokens at the host's cached rate (R-011).

## Interfaces
- Same `Adapter` interface as R-009. Events carry `adapter: 'stint-agent'`, `vendor: 'meta'`, and `host` on `run.finished`.
- Tools are JSON-schema function definitions; arguments are validated before a call runs.

## Acceptance
1. Replaying the recorded stream yields validating events with at least one tool call and a `run.finished.cost` with non-zero tokens: `packages/adapters/stint-agent/test/replay.test.ts`.
2. With `STINT_LIVE=1`: `stint hand T-0042 stint-agent` after the killed Muse Code run on the fixture copy ends `completed`, the daemon's verify is green, and no file under `done` was re-created: `packages/daemon/test/continue.live.test.ts` (skips with reason otherwise; the replay twin runs in CI).
3. A tool call to `git push` is refused, emitted as `rule.blocked`, and the adapter's `gate` flips to `enforced` in `/api/health`: `packages/adapters/stint-agent/test/gate.test.ts`.
4. A fake first host answering 429 moves the run to the next host and emits `provider.fallback`: `packages/adapters/stint-agent/test/fallback.test.ts`.

## Verify
```
bun test packages/adapters/stint-agent packages/daemon
STINT_LIVE=${STINT_LIVE:-0} bun test packages/daemon/test/continue.live.test.ts
```

## Out of scope
Resuming a session (the packet is the resume), sub-agents, a TUI, the UI (R-015, R-016).

## Notes
Keep the agent small and legible: one loop, six tools, one refusal set. Its system prompt is `prompt.md` plus a short tool contract. Keys stay in the environment and never appear in an event, a transcript line or `prompt.md`.
