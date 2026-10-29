# R-065 · The charcoal redesign: a calm workspace that says what needs you

Day: 5 (29 Oct) · Owner: CC · Depends on: R-059 (UI), R-062, R-063, R-064 · Fallback: tokens, primitives, shell and Board only · Cut order: 2

## Goal
The owner reports that the UI is confusing and hard to read for people who are colour-blind or have low vision. The navy Blueprint look puts every surface in one hue, and states are mostly small coloured words. This spec replaces the look with a near-black charcoal system and reorganises each page around four questions: what needs me, what is running, what is ready or waiting, and what I can safely do next. It keeps every backend status, every record, the keyboard model and the accessibility features. The owner's brief is the source; this spec restates it as requirements and records the decisions taken.

## Visual system
- Tokens (`apps/web/src/tokens.css`) are the owner's charcoal set, with the same semantic names and Tailwind mappings: near-black surfaces with a cool undertone, near-white ink, amber for attention and approval, mint green only for verified evidence, red for failure or stopped, violet for a learned skill's origin, neutral for merged and other closed outcomes. Vendor colours are small marks beside a name.
- Component classes (`styles.css`, components layer): `stint-page`, `stint-page-header`, `stint-topbar`, `stint-nav-link`, `stint-button` (+ `--primary`, `--quiet`, `--danger`), `stint-notice` (+ `--attention`, `--error`), `stint-board`, `stint-lane`, `stint-task-card`, `stint-status` (+ `--active`, `--attention`, `--verified`, `--failed`, `--learned`, `--recommend`), `stint-table`, `stint-field-*`, `stint-input`, `stint-dialog-*`. A Tailwind utility on the same element wins over them, so a component that adopts a class drops its old padding, background, border and grid utilities. No `!important`.
- No state rests on colour. Every status label draws a shape beside its word (`StateMark` in `ui.tsx`): a triangle needs you, a tick verified, a cross failed, a dot runs, a ring waits, a square is closed, a bar was abandoned, a diamond was learned.
- No gradients, glass, decorative grids, giant rounded cards, oversized statistics or motion that carries no meaning.

## Shared primitives (blocking, done first)
- `Button` tones: `primary` (filled near-white), `quiet` (the bordered default), `danger`, `ghost` (borderless). `aria-disabled` stops the click as well as saying the state.
- `StatusChip` takes a status, a tone or both, and an optional `shape`; `in_review` reads "In PR review" with a ring, so pull request review never looks like a running agent.
- `rev`: an ordinary table is quiet (a header row on panel, a rule between rows); `rev.block` keeps the heavy revision block for history, provenance and approval structures.
- `Dialog` (`Shell.tsx`): a header with the title and a visible Close, a scrolling body, an optional `footer` that stays in reach, `width` in pixels (default 640, never wider than the viewport less 32 px), and `dirty`, which turns a dismissal into "Discard this draft?" with Keep editing focused first. Focus trap, Escape, restored focus and the single-key guard are kept.

## Requirements
### 1. Shell
1. A compact top bar, not a sidebar: brand and project on the left (a long project name truncates with its full name in `title`), Board, Goals, Factory and Skills, then utilities (search, spend, status, Help) on the right.
2. The active page is marked by an underline and `aria-current="page"`, not by colour alone.
3. The command search stays reachable at every width; at 390 px the nav moves to its own row and nothing overflows the document.
4. The replay strip keeps its provenance words ("Replay, hand-written" or the recording) and says why an action is disabled there.

### 2. Board
1. A compact summary replaces the long sentence of task ids: counts of tasks that need you, are running and are planned, and, separately, the number of pending decisions. A decision is not a task and is never added to a task count.
2. Four groups, in order: **Needs you** (`awaiting_approval`, `rejected`, and any task autopilot stopped to ask you), **Planned** (`planned`), **In progress** (`building`, `verifying`, `reviewing`, `in_review`), **Closed** (`approved`, `done`, `abandoned`). Backend statuses and records do not change.
3. "Running" counts a task only while something executes for it: a run with no end, or Stint verifying or reviewing. A building task with no live run is in progress but not running. `in_review` is waiting on a pull request and is never running.
4. Inside each card the exact state is labelled: building, verifying, reviewing, in PR review; merged, approved, abandoned. A dependency-blocked planned task says which task it waits on.
5. The primary action: when a task needs approval, "Review T-xxxx" (the oldest waiting first); otherwise "Run all planned" when a planned task can run, otherwise "New task". "Run all planned" says what it does, including that a task waiting on another starts only after that one is done.
6. Four columns at 1200 px and wider, two from 768 px, one below. An empty group says what will appear in it.
7. A failed load never reads as "nothing needs you". On a refresh failure, the last data stays on screen with a stale warning; on a first-load failure, an error notice with a retry. Loading, error, empty and filtered-empty are four different states.

### 3. Task cards
1. The title dominates; the id is small, inline and monospaced.
2. One main status label, one summary or blocker line, the verification evidence when there is some, and quiet metadata: actor, elapsed time, cost.
3. A task that never ran does not claim it did, and shows no cost rather than a decorative $0.00. Unpriced spend reads as unpriced, never as $0.00. Generated summaries are labelled as summaries and never stand in for state.
4. A card that needs approval has one obvious action; no card becomes a row of buttons.

### 4. Task detail
1. The header answers what to do next: the state label, the one next action (Approve and merge at the gate, Return to latest when looking back, Stop when a run is live), the limits as quiet meters.
2. The seven tabs (Changes, Files, Terminal, Plan, Packet, Review, Tests), the runs, the revision block, the approval gate and memory adopt the charcoal system. Ordinary tables are quiet; the revision block keeps its heavy treatment.
3. Looking back is unmistakable: while the clock is not at now, a notice at the top says "You are looking at T-xxxx as it was at 2:12" with Return to latest, and every mutation (visible buttons, single-key shortcuts and palette commands) is unavailable until Return to latest. The palette offers Return to latest in their place.
4. At 390 px the gate and the tabs come before the long run history, so task work is reachable without scrolling through runs.
5. The runs list is never cut mid-line by the pinned approval box.

### 5. Goals, Factory, Skills
1. The same page structure, headings, buttons and quiet tables. Factory figures stay ordinary size, not dashboard statistics.
2. Goal detail, the split editor, Skills list and detail, the skill upload, the Git instructions and the editor adopt the system.

### 6. Dialogs and forms
1. New task, New goal, Add skill and Help use the shared `Dialog` with a footer for their actions.
2. Every create or mutate action has a pending guard: the button says it is working, is disabled while the request runs, and a second press does nothing.
3. A failed submission keeps everything typed and shows the daemon's message next to the actions.
4. A dialog with typed text asks before a dismissal drops it.

### 7. Trust and accessibility
1. Verification, review, warning acknowledgement and approval restrictions are unchanged.
2. Deep links and URL parameters (`?tab=`, `?asOf=`, `?memory=open`, `?at=`) keep working.
3. Visible focus, semantic controls, reduced motion, forced colours and keyboard navigation are kept. Contrast is measured on rendered pages, not claimed.
4. No document-level horizontal overflow at 1440, 1280, 768 or 390 px; code and wide tables scroll inside their own regions.

## Decisions
- The light theme the owner asked for on 29 Oct waits until after this spec: the brief is a dark theme, and following the system setting would show light-mode users something other than the charcoal look. The token contract stays, so a light set can be added later.
- The spec builder (one box that asks the few questions that matter and drafts the spec) follows this spec and is built on its dialog.

## Acceptance
1. `bash scripts/check.sh` and `bun run test:ui` pass. Tests change only where this spec changes behaviour (lane names, labels, dialog structure), never to weaken an assertion.
2. New browser tests cover: the four groups and the summary counts with a pending decision present; a refresh failure that keeps the board and shows a stale warning; Discard this draft? on New task; a double press on Create task makes one task; looking back blocks Approve, the `a` key and the palette's approve until Return to latest.
3. Screenshots at 1440×900, 1280×800, 768×1024 and 390×844 of every route, before and after, from `.loop/redesign/shots.mjs`; no document-level overflow at any size.
4. A rendered contrast audit of every visible text run on the main pages: text 4.5:1 or better, marks and field edges 3:1 or better.
5. DESIGN.md, the README screenshots and the docs describe the charcoal system.
