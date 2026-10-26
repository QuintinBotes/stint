# R-018 · Memory graph projection

Day: 6 (1 Nov) · Owner: CC · Depends on: R-003, R-017 · Fallback: pre-built JSON for the demo tasks · Cut: never (the panel can be cut, the queries stay)

## Goal
The memory is a projection, not a store: nodes and edges computed from `events.jsonl`, `decisions.md` and git at read time, cached in SQLite that can be deleted, bitemporal for free because every event carries when it was recorded and every decision carries when it was superseded. Three named queries and an `asOf` filter are what the UI, the planner prompt and the handoff card consume.

## Context
Node and edge table in the spec doc's Memory section. an earlier memory project's three ideas (bitemporal facts, decision ledger, adjudication queue) are kept as behaviours, not as a dependency. The `similar_to` embedding edge is a stretch; the shared-files-and-decisions score is the baseline.

## Requirements
1. MUST implement `packages/core/src/graph/`: `project(ws, { tasks?: string[] })` builds nodes `task`, `run`, `decision`, `file`, `finding`, `skill`, `outcome` and edges `touches`, `produced`, `cost`, `constrains`, `supersedes`, `co_changed`, `links_to`, `open_against`, `applied_in`, `proposed_from`, `resulted_in`, `similar_to`, every edge carrying `recordedAt` and `validTo` (null while valid) and the `eventId` that created it.
2. MUST implement `asOf(graph, ts)` returning only edges with `recordedAt ≤ ts < (validTo ?? ∞)` and the nodes they touch; a superseded decision's `constrains` edges end at the superseding decision's `recordedAt`; a resolved finding's `open_against` ends at the resolving event.
3. MUST implement the three queries: `similar(taskId)` (shared files and decisions, scored; embeddings when `config.routes.embed` names a host, local first and Fireworks' embedding endpoint as the hosted option, flagged `derived: true`), `filesTogether(path)` (files changed in the same runs, by count), `constrains(taskId, asOf?)` (decisions and open findings that apply to the task's files, valid at the time), plus `openFindings(taskId)` and `skillsHelped()` (skill → applied runs → approvals without rejection).
4. MUST cache in `.stint/cache/graph.sqlite` keyed by the max `seq` per task and the `decisions.md` hash; a stale key rebuilds; deleting the file loses nothing.
5. MUST add routes `GET /api/tasks/:id/graph?asOf=<ts>` → `{ nodes[], edges[], asOf }` (at most 60 nodes, the task in the centre, nearest by edge count) and `GET /api/graph/query?q=similar|files-together|constrains|open-findings|skills-helped&…` → rows, and the CLI `stint graph similar <task> | files-together <path> | constrains <task> [--as-of <ts>]`.
6. MUST feed `similar` into R-010's planner prompt (the three most similar tasks) and `constrains` into R-012's packet (`decisions` valid now) from this spec onward.
7. SHOULD add the adjudication queue read route `GET /api/graph/pending` (contradictions from R-010, entity merges of renamed files, proposals from R-020) with `POST /api/graph/pending/:id { decision }` recording the human's choice as an event so the derivation does not re-raise it.

## Interfaces
- Node `{ id, type, label, data }`; edge `{ id, from, to, type, recordedAt, validTo, eventId, data }`.
- `stint graph constrains T-0042 --as-of 2026-10-29T14:40:00Z --json`.

## Acceptance
1. On the seeded fixture (T-0040 history plus the replayed T-0042), `similar('T-0042')` returns T-0040 first with the two shared files named: `packages/core/test/graph.similar.test.ts`.
2. `filesTogether('src/webhooks/limiter.ts')` returns `router.ts` with count ≥ 1: `packages/core/test/graph.files.test.ts`.
3. `constrains('T-0042')` includes D3; with `asOf` before D3's `recordedAt` it does not; after a superseding D4 it includes D4 and not D3: `packages/core/test/graph.asof.test.ts`.
4. Deleting `graph.sqlite` and querying again returns identical rows: `packages/core/test/graph.cache.test.ts`.
5. `GET /graph` on T-0042 returns ≤ 60 nodes with the task at index 0: `packages/daemon/test/graph.route.test.ts`.

## Verify
```
bun test packages/core packages/daemon
./packages/cli/bin/stint graph similar T-0042 --json | head -c 300
```

## Out of scope
The force-layout panel and the scrubber UI (R-019), an earlier memory project ingest.

## Notes
`bun:sqlite` is built in; keep the schema to two tables (nodes, edges) with JSON data columns. Bitemporality costs nothing here because the inputs already carry both times; do not add a third timestamp. Keep the embedding path behind a config flag so CI never needs a model.
