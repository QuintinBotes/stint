# R-019 · Memory panel and time scrubber

Day: 6 (1 Nov) · Owner: MC · Depends on: R-007, R-018 · Fallback: a static graph image and the three queries as lists · Cut order: 2 (keep the three queries as lists)

## Goal
The beat that makes "memory" visible on stage: the derived graph beside the diff with one slider from the task's creation to now; drag it and a superseded decision fades, its successor appears, a resolved finding closes. The three queries as tabs, proposals from the learn step in a queue above the graph, and the Factory view with loops, cost bars and the benchmark chart.

## Context
Design: the `MemoryPanel` and `Factory` components, with `design/tokens.json`; the Factory view shows loops as a funnel, the graph with the scrubber, cost per day by vendor, the benchmark bars, the adjudication queue and the "It learned" pair. d3-force in a worker, at most 60 nodes, coloured by node type with the task in the centre. Charts via shadcn Chart (Recharts) following the dataviz rules: one system, accessible in dark and light.

## Requirements
1. MUST implement the memory panel (task view, right column, 360 px, collapsible, `m` toggles): a d3-force layout in a Web Worker rendering `GET /graph?asOf=`, node labels = file basename, decision id or run mark, colours by type from the tokens (task accent, decision warn, skill good, file and run neutral), hover shows the edge's `recordedAt` and the event that created it, click opens the file in the diff, the decision in `decisions.md` view, or the run on the rail.
2. MUST implement the time scrubber: one slider from `task.createdAt` to now (or the last event), debounced 100 ms, calling `?asOf=`; superseded decisions fade to 35 % opacity rather than vanish when they were valid at some earlier point in the window; the current `asOf` is shown as a timestamp; a "now" button resets.
3. MUST implement the three query tabs: Similar, Travels with, Constrains, each a list from `/api/graph/query` with the row's evidence (shared files, counts, decision text) and a link.
4. MUST implement the proposals queue above the graph: rows from `/api/graph/pending` and `/api/skills` (R-020) with Approve and Reject (reason) that call the daemon; contradictions show the decision and the finding side by side with "Keep D3" and "Supersede D3 with D4".
5. MUST implement the Factory view (`/factory`): KPIs (tasks in flight, stints and cross-vendor handoffs, week cost and per task, share of tokens that were transcripts fed forward, skills learned), Loops funnel by state over 7 days, the same graph with the scrubber, Cost per day by vendor (stacked bars, vendor colours), Benchmark bars when `bench/results.json` exists, the adjudication queue, and the "It learned" pair card (T-0042 vs T-0043 cost and findings).
6. MUST keep every chart legible in dark (default), light and stage, with text labels not colour alone, and tabular numbers.
7. SHOULD expose the scrubber's `asOf` in the URL (`?asOf=`) so a judge can link to a moment.

## Interfaces
- Worker message protocol: `{ type: 'layout', nodes, edges }` → `{ type: 'positions', nodes }` on each tick batch; the main thread never blocks.
- `/factory` reads `/api/costs?group=day`, `/api/graph/query?q=skills-helped`, `/api/skills`, `/api/graph/pending`, `bench/results.json` via `GET /api/bench`.

## Acceptance
1. After the replay, the T-0042 panel shows D3 and `limiter-config-via-env`; dragging the scrubber to before 14:38 fades D3 and removes the skill node: `apps/web/e2e/memory.spec.ts`.
2. The Constrains tab lists D3 with its text; Similar lists T-0040 with two shared files: same file.
3. A 60-node graph lays out within 1 s and the main thread stays responsive (the scrubber moves during layout): `apps/web/e2e/memory.perf.spec.ts`.
4. The Factory view renders KPIs, the funnel, cost bars with a legend, and the queue with two rows from the replay: `apps/web/e2e/factory.spec.ts`.
5. Approving a queued skill from the panel calls `POST /api/skills/:id/approve` and the row leaves the queue: `apps/web/e2e/queue.spec.ts` (with R-020; before it, the test is marked pending with the reason).

## Verify
```
bun run test:ui
```

## Out of scope
Graph editing, importing from an earlier memory project, embeddings UI.

## Notes
The scrubber is one route parameter and one filter; keep it that simple. Cap the panel at 60 nodes by edge count from the task; show "31 of 58 nodes" so the cap is honest. Load d3-force only in the worker to keep the main bundle small.
