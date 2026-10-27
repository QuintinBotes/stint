# R-012 · Handoff builder

Day: 4 (30 Oct) · Owner: Q · Depends on: R-003, R-005, R-009 · Fallback: a hand-written packet for the demo · Cut: NEVER (the pitch)

## Goal
The daemon derives a `stint.handoff/1` packet from `events.jsonl` and the diff for every ending (completed, capped, killed, failed, handed), lets the leaving adapter enrich four fields with one structured call, counts its tokens, renders it as the prompt the next agent reads, and keeps every packet. A run killed mid-edit still yields a complete, honest packet under 600 tokens with the in-flight step marked unknown. This is the artefact the whole product is named for.

## Context
Schema and rules in R-002 and `schemas/handoff.schema.json`. The prose rendering and multi-hop rules are ported from an earlier terminal project's context bundle: fixed headings parsed back by exact string; only the task, the refusals and the origin cross a hop; limits 600-character excerpts, 12 items per list, 4,000-character carried briefing; the packet reads command excerpts, never tool-output summaries, which is how a test proves credentials never reach it.

## Requirements
1. MUST implement `packages/daemon/src/handoff.ts` `buildHandoff(task, run, { to?, enrich? })`:
   - `from` from `run.started`/`run.finished`; `endedBy` from `run.finished`;
   - `done` from plan steps whose files all appear in `file.changed` and whose tests passed, plus `verification.ran` summaries; `open` from plan steps not reached plus any `askOfNext` carried in; `leftOut` = `plan.filesToTouch` minus changed files, plus "In-flight step unknown: <last tool call>" when `endedBy` is `killed` and the last `agent.tool_call` has no `agent.tool_result`; `risks` carried from `plan.risks` and any `risk` the agent stated; `decisions` from `decision.recorded` events of this task valid now; `changedFiles` and `diffRef` from R-005's diff; `verification` from the latest `verification/<run>.json` or `null` with `verification.status: 'not_run'`; `cost` from R-011; `askOfNext` = the first `open` item rephrased as an instruction, prefixed with "Check the unknown step first." when one exists; `summary` = the last `agent.message` of the run truncated to 400 chars until enrichment replaces it;
   - `hash` = `sha256:` of the canonical packet without `hash`;
   - validates against the schema, counts tokens, and refuses (with `packet_too_large` and the offending fields) only after trimming lists to 12 items and strings to limits still exceeds 600 tokens.
2. MUST call `adapter.enrich()` when `enrich: true` and the adapter has it, merge only `summary`, `leftOut` (append, dedupe), `risks` (append), `askOfNext` (replace), re-validate, and keep the daemon's values if enrichment fails or violates limits; record which fields were enriched in `handoffs/<h>.meta.json` with the event ids each field derives from (the "why" view in the UI).
3. MUST write `handoff.json` (latest) and `handoffs/h<N>.json`, emit `handoff.created { hash, from, to, tokens, bytes }`, and on `endedBy: killed` build the packet from the log alone (no enrichment call to a dead session; `enrich` is attempted via `resume` only when the adapter is resumable and the session id exists, with a 20 s cap).
4. MUST implement `POST /api/tasks/:id/handoff { to?, enrich? }` (build or rebuild), finish `POST /api/tasks/:id/runs/:run/stop` from R-009 so it returns the packet, and `POST /api/tasks/:id/hand { adapter, role?, ask? }` = handoff with `to` then `assign` with `handoffFrom` (the CLI's `stint hand`).
5. MUST implement the multi-hop rule in `renderPrompt`: a packet whose `from.endedBy` is `handed` carries only the task, the refusals and the origin of the earlier hop (under `## Where it got to`: "Before that it was with <agent>"), never the earlier hop's done/open lists, so by the fourth agent the prompt is not mostly its own history.
6. MUST prove secrets do not cross: the builder reads only `agent.message` text and `agent.tool_call` names and arguments truncated to 600 chars, never `agent.tool_result` bodies; a test injects `AWS_SECRET_ACCESS_KEY=…` into a tool result and asserts it appears nowhere in `handoff.json` or `prompt.md`.
7. SHOULD expose `stint packet <task> [--run rN] [--as prompt|json]` printing the packet and its token count.

## Interfaces
- `buildHandoff(task: Task, run: string, opts): Promise<{ handoff: Handoff; meta: HandoffMeta }>`; `HandoffMeta = { fields: Record<keyof Handoff, { from: 'events' | 'diff' | 'plan' | 'enrich'; eventIds: string[] }> }`.
- Error `packet_too_large { tokens, limit, fields }`.

## Acceptance
1. On the replayed T-0042 log, `buildHandoff` after the killed r2 yields a packet that validates, is under 600 tokens, has `endedBy: 'killed'`, `leftOut` containing "In-flight step unknown", and `askOfNext` starting with "Check the unknown step first.": `packages/daemon/test/handoff.kill.test.ts`.
2. The same packet's `hash` is stable across two builds and changes when `events.jsonl` gains a `file.changed`: same file.
3. Enrichment that returns a 900-char `summary` is rejected and the daemon's summary kept, with `meta.fields.summary.from === 'events'`: `packages/daemon/test/handoff.enrich.test.ts`.
4. A tool result containing a credential never appears in the packet or `prompt.md`: `packages/daemon/test/handoff.secrets.test.ts`.
5. A third hop's prompt contains the first hop's refusals attributed to the first agent and none of its `done` items: `packages/daemon/test/handoff.multihop.test.ts`.
6. `stint hand T-0042 stint-agent --ask "…"` on a fake adapter creates `handoffs/h1.json`, emits `handoff.created` then `run.started` with `handoffFrom: 'h1'`: `packages/cli/test/hand.test.ts`.

## Verify
```
bun test packages/daemon packages/cli
./packages/cli/bin/stint packet T-0042 --as prompt | wc -c
```

## Out of scope
The UI card (R-016), the Stint agent's side (R-013), Muse hooks (R-014).

## Notes
The 600-token limit is a product rule, not a model limit: a packet that does not fit is a packet that says too much. Trim lists from the tail except `refusals`, which keep the last 12. Keep the rendering and the parser in `@stint-dev/core` (R-002); the daemon only composes. The demo's numbers (412 tokens, 1.4 KB) come from this code on the real run; do not fake them in the live path.
