# R-009 · Muse Code adapter (implement)

Day: 3 (29 Oct) · Owner: Q, handed to MC · Depends on: R-004, R-005 · Fallback: plain `muse exec` without the JSON stream, events from the diff snapshots only · Cut: never

## Goal
The hero adapter: Muse Code implements a task inside the worktree, its JSON event stream lands on the timeline one to one, a run can be capped by steps or budget, resumed by session id, and killed, and every ending yields the data the packet builder (R-012) needs. "Real worktree, real diff, real cost" is this spec.

## Context
Adapter contract in the spec doc and `AGENTS.md`. Backend: `muse exec --json --prompt-file <rendered> --disable-approval --max-model-steps N` with `cwd` = worktree; resume with `muse exec --session-id <uuid>`; `muse schema` is the source of truth for the JSONL shape and the mapper is generated from it. Observers are disabled for daemon-driven runs so metered cost is the run's own. Muse Code reads `.agents/skills` natively.

## Requirements
1. MUST implement `packages/adapters/muse-code/src/index.ts` exporting `museCodeAdapter: Adapter` with `id: 'muse-code'`, `vendor: 'meta'`, `roles: ['planner','implementer','reviewer']`, `capabilities: { editsFiles: true, runsCommands: true, resumable: true, structuredOutput: true, offline: false }`, `available()` (runs `muse --version`, checks `META_API_KEY`, returns `{ ok, version, reason }` and `gate: 'observed'`).
2. MUST implement `run()`: write `prompt.md` (rendered packet if any + plan + skills list + diff, cache-stable prefix first), spawn `muse exec --json --prompt-file prompt.md --disable-approval --max-model-steps <budget.steps>` in the worktree with observers off, map each JSONL line to `agent.message` / `agent.tool_call` / `agent.tool_result` (unknown lines → `runtime.unclassified`, never dropped), truncate text to 2 KB in the log with the full line in `transcript.jsonl`, record `sessionId` from the result, and return `{ endedBy, sessionId, cost, transcriptPath }` with `endedBy` = `completed` on a clean result, `capped` on max steps or budget, `killed` when the daemon stopped it, `failed` otherwise.
3. MUST implement `resume()` via `muse exec --session-id <id> --json --prompt-file <instruction>` with the same mapping, and `enrich()`: one structured call asking the leaving session for `summary`, `leftOut`, `risks`, `askOfNext` against `schemas/handoff.schema.json` (returns `{}` on failure, never throws).
4. MUST implement the mapper as generated code: `bun run --cwd packages/adapters/muse-code gen:schema` runs `muse schema`, saves it under `src/generated/muse-schema.json`, and the mapper's types come from it; the test asserts the saved schema matches the installed `muse` when `STINT_LIVE=1`.
5. MUST add `POST /api/tasks/:id/assign { adapter, role, model?, instruction?, handoffFrom? }` in the daemon: refuse `capability_mismatch` when the adapter lacks the role, `budget_exceeded` when the role budget is spent, `adapter_unavailable` when `available().ok` is false, `run_active` when a run is live; otherwise create the worktree (R-005), mount skills (list only until R-020), render `prompt.md`, emit `run.started`, start the adapter, and on completion commit the worktree, emit `run.finished` with cost and `endedBy`, then verify (R-005).
6. MUST implement kill: `POST /api/tasks/:id/runs/:run/stop` kills the process group, waits up to 5 s, commits the worktree, emits `run.finished { endedBy: 'killed' }` with the last tool call marked `inFlight: true` in the payload, and triggers the packet (R-012 fills it; until then the route returns 202).
7. SHOULD record `cost` from the JSONL result's usage object (input, cached, output) and price it with `config.prices` (R-011 completes the meter).

## Interfaces
- Prompt rendering: `packages/daemon/src/prompt.ts` `renderPrompt({ task, plan, handoff?, skills, diff }): string` with sections in this order: system framing, skills list, plan, diff summary, packet (`renderHandoff`), the ask; byte-identical prefix across turns.
- Recorded replay twin: `packages/adapters/muse-code/test/fixtures/exec-run.jsonl` captured from a real `muse exec --json` on the fixture.

## Acceptance
1. Mapping the recorded JSONL fixture yields events that validate and contain at least one `agent.tool_call` and one `agent.tool_result`; an injected unknown line becomes `runtime.unclassified`: `packages/adapters/muse-code/test/mapper.test.ts`.
2. With `STINT_LIVE=1` and a key: assigning T-0042 on the fixture copy edits files, `run.finished.endedBy` is `completed` or `capped`, and the daemon's verify runs: `packages/daemon/test/muse.live.test.ts` (skips with reason otherwise).
3. `stop` during a run produces `run.finished { endedBy: 'killed' }` within 6 s and the worktree has a `wip(` commit: `packages/daemon/test/stop.test.ts` (uses a fake adapter that sleeps; the live twin under `STINT_LIVE`).
4. `assign` with role `reviewer` for an adapter without that role returns 400 `capability_mismatch`: `packages/daemon/test/assign.test.ts`.
5. `prompt.md` for a second turn shares a byte-identical prefix up to the packet section: `packages/daemon/test/prompt.test.ts`.

## Verify
```
bun test packages/adapters/muse-code packages/daemon
STINT_LIVE=${STINT_LIVE:-0} bun test packages/daemon/test/muse.live.test.ts
```

## Out of scope
Plan and review calls (R-010), the packet content (R-012), hooks (R-014).

## Notes
`--disable-approval` is required for unattended runs; never pass a bypass flag that Muse documents as dangerous, and label the gate `observed` (Stint cannot stop a tool call in Muse Code yet). Keep the Muse CLI version in `config.json` and print it in `available()`. If `muse schema` output changes between kickoff and demo, regenerate and commit; the mapper must not hand-maintain field names.
