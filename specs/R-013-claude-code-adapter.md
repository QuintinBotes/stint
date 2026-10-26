# R-013 · Claude Code adapter (continue)

Day: 4 (30 Oct) · Owner: MC, handed to CC · Depends on: R-012 · Fallback: a replay of the recorded continue run; or, if the rules forbid a non-Meta model, a second Muse Code run on another model id takes this beat · Cut: NEVER (the pitch)

## Goal
A different vendor finishes the task from the packet alone: Claude Code reads `prompt.md` (packet + plan + skills + diff), checks the unknown step first so there is no duplicate work, completes the open items, and the daemon's verify goes green. The adapter is one file; nothing about it is special except that it proves the packet is vendor-neutral.

## Context
`@anthropic-ai/claude-agent-sdk` ≥ 0.3.296, V1 `query()` with `cwd` = worktree, `maxTurns`, `resume: sessionId` for a second continue, `permissionMode: 'acceptEdits'` and `canUseTool` for the gate (this is the one adapter with an **enforced** gate in the window). The rendered packet is the first prompt. The key lives only in the environment on the demo machine.

## Requirements
1. MUST implement `packages/adapters/claude-code/src/index.ts` exporting `claudeCodeAdapter: Adapter` with `id: 'claude-code'`, `vendor: 'anthropic'`, `roles: ['implementer','reviewer']`, capabilities `{ editsFiles: true, runsCommands: true, resumable: true, structuredOutput: true, offline: false }`, `available()` (SDK import, `ANTHROPIC_API_KEY` present, CLI version if installed) and `gate: 'enforced'` only after the first `canUseTool` call has actually been answered in this daemon lifetime (`observed` before that).
2. MUST implement `run()`: `query({ prompt: prompt.md, options: { cwd: worktree, maxTurns, permissionMode: 'acceptEdits', allowedTools, canUseTool, abortController } })`, map the SDK message stream one to one (`assistant` text → `agent.message`, tool use → `agent.tool_call`, tool result → `agent.tool_result`, unknown → `runtime.unclassified`), store `session_id` from the result message in `runs/<r>/meta.json`, usage → `cost`, and `endedBy` from the result (`completed`, `capped` on `maxTurns` or budget, `killed` on abort, `failed` on error).
3. MUST implement `canUseTool`: every call is classified by the daemon's refusal set (a command that writes outside the worktree, a `git push`, a network upload, a credential path) → deny with a reason recorded as `rule.blocked`; everything else allowed; the decision and its reason are emitted as events so the timeline shows the gate working. Hold a human decision for at most 3.5 s (no human in the loop in the window; deny with "nothing was decided" after the hold).
4. MUST implement `resume()` with `resume: sessionId` and the new instruction as the prompt, and `review()` (used only if Glimmer is unavailable) with structured output against `schemas/review.schema.json`.
5. MUST implement the "no duplicate work" check in the prompt: `renderPrompt` places the unknown-step line first under `## Ask of next`, and the acceptance test asserts the continue run does not re-create files the packet lists under `done`.
6. MUST provide a replay twin: `packages/adapters/claude-code/test/fixtures/continue-run.jsonl` captured from the real continue on the fixture, and a test that replays it through the mapper.
7. SHOULD add the Claude list prices to `config.prices` defaults (`claude-sonnet-4-5`, `claude-opus-4-1`, or whichever the SDK defaults to at kickoff, taken from the pricing page on that day and noted in a Decision).

## Interfaces
- Same `Adapter` interface as R-009; `allowedTools` default `['Read','Edit','Write','Bash','Glob','Grep']`.
- Events carry `adapter: 'claude-code'`, `vendor: 'anthropic'`.

## Acceptance
1. Replaying the recorded SDK stream yields validating events with at least one tool call and a `run.finished.cost` with non-zero tokens: `packages/adapters/claude-code/test/mapper.test.ts`.
2. With `STINT_LIVE=1`: `stint hand T-0042 claude-code` after the recorded killed packet on the fixture copy ends `completed`, the daemon's verify reports 33 passed, and no file under `done` was re-created (checked by diff against the r2 worktree commit): `packages/daemon/test/continue.live.test.ts` (skips with reason otherwise; the replay twin runs in CI).
3. A `canUseTool` request for `git push` is denied, emitted as `rule.blocked`, and the adapter's `gate` flips to `enforced` in `/api/health`: `packages/adapters/claude-code/test/gate.test.ts`.
4. `resume()` with a stored session id sends the new instruction and maps the stream: same mapper file (fixture).

## Verify
```
bun test packages/adapters/claude-code packages/daemon
STINT_LIVE=${STINT_LIVE:-0} bun test packages/daemon/test/continue.live.test.ts
```

## Out of scope
Hooks (SDK hooks are optional; the daemon drafts on `run.finished`), the UI (R-015, R-016).

## Notes
Pin the SDK version in `package.json` and note the V2 removal in 0.3.142: use V1 `query()` only. Keep the key out of every log line and out of `prompt.md`. If the official rules forbid the Claude hop, this adapter stays in the repo (it is the proof of vendor neutrality) but the demo's continue beat runs on Muse Code with a different model id; R-022's recording decides.
