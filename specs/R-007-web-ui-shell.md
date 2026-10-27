# R-007 · Web UI shell

Day: 2 (28 Oct) · Owner: MC · Depends on: R-004, R-006 · Fallback: drop the board, open straight on T-0042 · Cut: never

## Goal
The React app the daemon serves: the board and the task view laid out, the SSE client, the design tokens with dark as default, and the command palette skeleton. After this spec the replay is visible end to end as a list of events in the right places; R-015 and R-016 make it beautiful.

## Context
Design system: the Stint tokens (`design/tokens.json`, three themes, dark default), Geist, shadcn/ui on Base UI (Rhea style), Kibo UI Kanban, `cmdk`, `react-resizable-panels`, `sonner`. Screen layouts are the `Board` and `TaskView` components in `apps/web/src/routes/`, with `design/tokens.json`. UI copy rules are non-negotiable 12 in `AGENTS.md`.

## Requirements
1. MUST set up `apps/web`: Vite 7, React 19, Tailwind 4 with `@theme inline` mapping the token CSS variables, `data-theme` on `<html>` with `dark` default and `light`/`stage` opt-in (persisted in `localStorage`, "system" honours `prefers-color-scheme` only when chosen), Geist and Geist Mono from Google Fonts, shadcn/ui initialised (Base UI, Rhea), lucide-react.
2. MUST implement the shell: top bar (wordmark, repo name, ⌘K button, week cost, daemon and Ollama health chips with capability and gate strength, theme toggle), the Board route `/` (Kibo Kanban lanes Needs you, Planned, Building, Verifying, Reviewing, Done; cards with title, holder mark, age, cost, summary), the Task route `/t/:id` (three resizable columns: rail 320 px, work area with tabs Diff, Terminal, Plan, Packet, Review, Verification, memory panel 360 px collapsible; approval gate docked at the rail's bottom), and an empty state on every panel that says what will appear.
3. MUST implement the data layer: `useHealth()`, `useTasks()`, `useTask(id)`, `useEvents(id)` over fetch + SSE with `Last-Event-ID` resume and a 1 s poll fallback, and a typed client in `apps/web/src/api.ts` generated from the daemon's route table (hand-written is fine; types from `@stint-dev/core`).
4. MUST implement the `cmdk` palette with the actions new task, assign, hand to, verify, approve, open terminal, switch theme, jump to task, each showing its CLI equivalent; actions not yet wired show "arrives in R-0xx".
5. MUST render the replay: when health reports `mode: 'replay'`, a strip under the top bar says "Replay of a live run on <date>" (or "Replay, hand-written" until R-022).
6. MUST pass phone width: lanes stack, columns stack, 16 px gutter, no horizontal scroll.
7. SHOULD add Playwright (`bun run test:ui`) with one test that plays the replay at speed 0 and asserts the board shows T-0042 in Building and the task view lists its events.

## Interfaces
- Routes: `/`, `/t/:id`, `/factory` (placeholder until R-019), `/skills` (placeholder until R-020).
- Keyboard: `n` new task, `j`/`k` along the timeline, `d` diff, `t` terminal, `m` memory, `h` handoff, `a` approve, `r` request changes, `x` reject, `?` help, `⌘K` palette (bindings exist; handlers for a/r/x land in R-016).

## Acceptance
1. `bun run build:web` succeeds and the daemon serves `/` with the shell: `apps/web/e2e/shell.spec.ts`.
2. After `stint demo --speed 0`, the board shows three cards in the right lanes and the task view for T-0042 lists 100+ events: `apps/web/e2e/replay.spec.ts`.
3. `<html data-theme>` is `dark` on first load; the toggle persists `light` across reload: `apps/web/e2e/theme.spec.ts`.
4. At 390 px width the board has no horizontal scroll: `apps/web/e2e/phone.spec.ts`.
5. Every panel in an empty task shows its empty-state sentence: `apps/web/e2e/empty.spec.ts`.

## Verify
```
bun run build:web
bun run test:ui
```

## Out of scope
The timeline rail design (R-015), cards and gate behaviour (R-016), terminal (R-008), memory panel (R-019).

## Notes
Copy the token CSS from `design/tokens.css`; never author a colour outside it. Vendor colours only on marks and rail segments. No gradients, no decorative cards, no icons where a word does. Keep components in `apps/web/src/components/` with the eight design-system components (VendorMark, StatusChip, TaskCard, RunSegment, HandoffCard, VerificationCard, ApprovalGate, CostMeter) re-implemented as React from the design system's READMEs.
