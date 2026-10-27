# R-052 · Memory and the Factory, complete

Day: added 27 Oct from the requirements audit · Owner: MC · Depends on: R-015, R-018, R-019 · Fallback: requirements 1, 6 and 7 · Cut order: 4

## Goal
Finish what R-015, R-018 and R-019 asked: the diff names the run behind each hunk, the graph carries the edges and the similarity it was specified with, the packet carries the decisions that constrain the task, and the Factory shows the graph, the funnel and the share of tokens fed forward.

## Context
The graph is `packages/core/src/graph/index.ts` (nodes, edges, `similar`, `constrains`, `asOf`), served by `packages/daemon/src/routes/graph.ts`; the packet is built in `packages/daemon/src/handoff.ts`; the memory panel is `apps/web/src/components/MemoryPanel.tsx`; the Factory is `apps/web/src/routes/Factory.tsx`; the diff is `apps/web/src/components/DiffView.tsx` (attribution per file today, marked `shortcut:`). Each run's `run.finished` carries the commit it ended on.

## Requirements
1. MUST attribute each hunk to the run whose commit last wrote its lines, from `git blame` on the task branch over `base..head` mapped to runs by their `run.finished` commits, served as `GET /api/tasks/:id/diff?format=json&blame=1` (per file, a list of `{ start, end, run }` line ranges on the new side); the diff shows it on hover and falls back to per-file attribution when blame is unavailable.
2. MUST add the edge types `cost` (run to model, with usd and tokens) and `links_to` (finding to rule or decision it cites), projected from existing events.
3. MUST compute similarity with embeddings when `routes.embed` names a model (an OpenAI-compatible `/v1/embeddings` or Ollama `/api/embed`), cached in `.stint/cache/embeddings.json` by text hash, marking those edges `derived: true`; without `routes.embed` similarity stays as it is.
4. MUST put the `constrains` rows (decisions of other tasks and open findings on the same files, valid at the packet's time) into the packet's `decisions` after this task's own, within the packet's token cap.
5. SHOULD include in the pending queue the skill proposals and the file-rename merges the projection detects, beside contradictions.
6. MUST make decision and run nodes clickable in the memory panel (a decision opens its row in the timeline at `decision.recorded`; a run opens its segment) and label file nodes with their basename.
7. MUST add to the Factory: the memory graph with its scrubber for the whole workspace; a KPI for the share of input tokens that were transcripts fed forward against packets; a loops funnel by state over the last 7 days from the events (tasks that entered each state), not the current status count.

## Interfaces
- `GET /api/tasks/:id/diff?format=json&blame=1` → `Array<{ path, added, removed, hunks?: Array<{ start, end, run }> }>`.
- `GET /api/graph?asOf=` (workspace graph) for the Factory.
- Config: `routes.embed: string[]` (host/model).

## Acceptance
1. Hovering a hunk in a file two runs wrote names the right run for each hunk: `packages/daemon/test/diff.blame.test.ts`, `apps/web/e2e/diff.spec.ts`.
2. The graph has `cost` and `links_to` edges after the replay: `packages/core/test/graph.edges.test.ts`.
3. With a fake embeddings host, similarity uses it and marks the edges derived; without one nothing changes: `packages/core/test/graph.embed.test.ts`.
4. A packet for a task whose files another task's decision constrains carries that decision: `packages/daemon/test/handoff.constrains.test.ts`.
5. Clicking D3 in the panel selects its timeline row; clicking a run node selects its segment; a decision superseded during the window is faded to 35% after its end and on before it, and a node not yet recorded is hidden: `apps/web/e2e/memory.spec.ts`.
6. The Factory shows the graph, the transcript-share KPI and a 7-day funnel: `apps/web/e2e/factory.spec.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh && bun run test:ui
```

## Out of scope
A graph database; embeddings for code.

## Notes
`bge-m3` on Ollama is a ready embedding model for a live check. Blame runs on the task branch in the main repository; a worktree may be gone after merge.
