# R-015 · Timeline and diff

Day: 5 (31 Oct) · Owner: MC · Depends on: R-006, R-007 · Fallback: a plain list of events and a plain unified diff · Cut: never

## Goal
The hero of the task view: one vertical rail per task where each run is a segment coloured by vendor, handoffs are joints between segments with the token count, events inside a run collapse to tool calls and file changes, and the diff beside it is a real `git diff` with syntax highlighting, split and stacked modes, mark-as-viewed and line comments that become the next ask. Replay and live render identically.

## Context
Design: the Task view artboard and the design-system `RunSegment` (vendor colour, role and model header, state chip thinking/waiting/executing/done/killed/capped) and the W3/W5 wireframes. Libraries: shadcn AI Elements (Trace rows), `@pierre/diffs` 1.5.x with shiki 4.x, a virtualised list (TanStack Virtual) for 5k-event timelines. The an earlier terminal project `is_notable` idea decides what raises attention.

## Requirements
1. MUST implement the rail: segments from `run.started`/`run.finished` pairs (live segment pulses at opacity 0.6 to 1 over 1.2 s, honouring `prefers-reduced-motion`), header with vendor mark, role, model, state chip, duration and cost; joints from `handoff.created` (packet icon, token count, click opens the handoff panel); verification and review as their own marked rows; `human.command` rows styled distinctly; the approval gate docked at the bottom (behaviour in R-016).
2. MUST collapse events by default to tool calls, file changes, decisions, verification, review and refusals; "Show all" expands to Trace rows including `agent.message` text; reasoning passages are counted and collapsed, never hidden; `runtime.unclassified` rows show their original type.
3. MUST virtualise the rail (5,000 events stay at 60 fps on scroll) and keep the viewport pinned to the newest event while live unless the person scrolled up (a "jump to latest" pill appears).
4. MUST implement the Diff tab: `GET /api/tasks/:id/diff?format=json` rendered with `@pierre/diffs` (split and stacked), shiki highlighting with the dark theme default, a changed-file tree (236 px, collapsible to 172 px), per-file mark-as-viewed persisted per task in `localStorage`, hunks attributed to the run that wrote them (from `file.changed` timestamps) on hover, and files listed in the packet's `leftOut` shown beside the diff under "Left out".
5. MUST implement click-any-line comments stored as `.stint/tasks/<id>/comments.json` through `POST /api/tasks/:id/comments` (daemon writes) and offered as the `askOfNext` suffix on the next `stint hand` ("Review comments: file:line text …").
6. MUST keep keyboard: `j`/`k` move the rail selection, `Enter` expands, `d` focuses the diff, `[`/`]` previous/next file, `v` mark viewed.
7. SHOULD show a Checkpoint marker at every run boundary with a "restore" menu (code, conversation, both) that is wired to `git` for code (`git checkout stint/<task>@{<run end>}` into a new worktree) and disabled with a tooltip for conversation until a later release.

## Interfaces
- `GET /api/tasks/:id/comments`, `POST /api/tasks/:id/comments { file, line, text }` → `Comment[]`.
- Rail selection state and diff file selection are URL-addressable: `/t/T-0042?ev=183&file=src/webhooks/limiter.ts`.

## Acceptance
1. After `stint demo --speed 0`, the T-0042 rail shows 4 segments (planner, r1 Muse, r2 Claude, r3 Glimmer review) with vendor colours and one joint labelled "412 tokens": `apps/web/e2e/timeline.spec.ts`.
2. A synthetic 5,000-event task renders and scrolls without dropped frames (Playwright trace, frame budget assertion): `apps/web/e2e/timeline.perf.spec.ts`.
3. The Diff tab shows three files, the hunk at `limiter.ts` attributed to r1 on hover, and "Left out" listing the packet's two entries: `apps/web/e2e/diff.spec.ts`.
4. Adding a line comment writes `comments.json` through the daemon and `stint hand` includes it in `askOfNext`: `packages/daemon/test/comments.test.ts` and `apps/web/e2e/comments.spec.ts`.
5. `j`/`k` move selection and the URL updates: `apps/web/e2e/keys.spec.ts`.

## Verify
```
bun test packages/daemon
bun run test:ui
```

## Out of scope
The handoff, verification and review cards' content (R-016), the memory panel (R-019).

## Notes
Vendor colours only on marks and segments: Muse gold, Claude slate, local zinc, from the tokens. The rail must read the same in dark, light and stage; test stage once by eye at the end. Do not render agent text as markdown by default; it is evidence, not prose.
