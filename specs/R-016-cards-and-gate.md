# R-016 · Cards and the approval gate

Day: 5 (31 Oct) · Owner: MC · Depends on: R-012, R-015 · Fallback: fewer cards, the gate first · Cut: never

## Goal
Every card in the task view declares a state and an empty state, so the live demo never shows a blank panel: the verification card the daemon fills, the handoff card with `askOfNext` highlighted and a "why" expander per field, the review card with severity, offline badge and contradiction chip, the plan card, and the approval gate with `a`, `r`, `x` and a sign-off record. The handoff panel's "Hand to" picker lives here too.

## Context
Design: the components `HandoffCard`, `VerificationCard`, `ApprovalGate` and `StatusChip` in the `TaskView`, with `design/tokens.json`. Honest copy per non-negotiable 12 in `AGENTS.md`. The "why" view reads `handoffs/<h>.meta.json` from R-012.

## Requirements
1. MUST implement states for every card: planned, running, finished, verified, handed off, awaiting approval, approved, rejected, failed, killed, capped, each with a `StatusChip` and an empty-state sentence ("The plan arrives here when the planner finishes.", "Verification runs here when the run ends.", "The packet appears here when a run ends, however it ends.").
2. MUST implement the Verification card: command, exit code, passed/failed, duration, "run by the daemon" label, acceptance criteria mapped to checks when the test names match, Stack Trace (AI Elements) on failure, and a "Re-run" button (`POST /verify`).
3. MUST implement the Handoff card and panel: sections in packet order with `askOfNext` highlighted, header with tokens and bytes, "why" expander listing the event ids per field (click opens the rail at that event), raw JSON (`react-json-view-lite`) and "As prompt" views, the "Hand to" picker listing adapters with availability, role, capability note and gate strength, an optional extra ask, and the Hand button (`POST /hand`); the recommended adapter is never the same vendor as the leaving one when another is available, and the reason is shown.
4. MUST implement the Review card: verdict, findings with severity and file:line links into the diff, blockers, `offline` badge when the reviewer ran locally, and for a finding with `contradictsDecision` the decision text and a "routed to the queue" chip with a link to the Factory queue; a "No actionable findings." review renders as exactly that sentence.
5. MUST implement the Approval gate: docked at the rail's bottom; enabled only when the latest verification is green and the latest review is not `block` (the daemon enforces the same on `POST /approve`); actions Approve and merge (`a`), Request changes (`r`, opens a text field whose content becomes the next ask), Reject (`x`, reason required); after approve it shows the sign-off record (who, when, verification hash, commit) on the merged card; per-run permission tier chip (manual, auto with daemon verify, never bypass).
6. MUST implement the Plan card (steps with done/open state from the packet, files, risks, similar tasks) and the board card summary line from local Glimmer when available (`POST /api/tasks/:id/summary` cached per event seq; falls back to the last `agent.message`).
7. SHOULD add toasts (sonner) for run finished, needs approval, verification failed, and an OS notification when a run finishes while the window is unfocused; a sound on "needs you" that can be turned off in the palette.

## Interfaces
- Gate keyboard: `a` approve, `r` request changes, `x` reject; the palette lists the same with their CLI equivalents (`stint approve`, `stint reject --reason`).
- `POST /api/tasks/:id/approve` and `/reject` are implemented in R-017; until merged, the gate calls them and shows the daemon's error honestly.

## Acceptance
1. In the replayed T-0042, the verification card shows "33 passed · 0 failed · run by the daemon" and the handoff card highlights `askOfNext` with 412 tokens in the header: `apps/web/e2e/cards.spec.ts`.
2. Each card in an empty task shows its empty-state sentence and a `planned` chip: `apps/web/e2e/empty.spec.ts` (extends R-007).
3. The review card shows the offline badge and one finding with the "routed to the queue" chip and D3's text: `apps/web/e2e/review-card.spec.ts`.
4. The gate is disabled while verification is red or absent and enabled after a green verify; pressing `a` calls `/approve`: `apps/web/e2e/gate.spec.ts`.
5. The Hand to picker never recommends the leaving vendor when another adapter is available and shows the reason: `apps/web/e2e/handoff-panel.spec.ts`.

## Verify
```
bun run test:ui
bun test packages/daemon
```

## Out of scope
The merge itself (R-017), the memory panel (R-019), skills UI (R-020).

## Notes
Build the eight design-system components as React once (R-007) and compose here; do not restyle per card. The "why" expander is the honesty feature a judge can click; keep it one click away, never behind a settings toggle.
