---
name: Stint
description: A calm engineering workspace for coding agents. Near-black charcoal, near-white ink, a shape beside every state, and one signature move, the revision block.
colors:
  shell: "#090c10"
  ground: "#0b0f14"
  panel: "#141b24"
  panel-2: "#1b2633"
  surface-hover: "#192330"
  surface-selected: "#202e3e"
  rule: "#283647"
  rule-strong: "#66788c"
  field: "#74869a"
  ink: "#eef3f8"
  ink-2: "#c6d1df"
  ink-3: "#abb9ca"
  vendor-meta: "#70b5ff"
  vendor-anthropic: "#e8ad88"
  vendor-openai: "#78d9b3"
  vendor-local: "#c9d4e2"
  state-amber: "#ffd369"
  state-green: "#93e5c0"
  state-red: "#f2786f"
  state-violet: "#d2c2ff"
  terminal: "#080c11"
  focus: "#a5caff"
  selection: "#27466a"
typography:
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "30px"
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  small:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  code:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
rounded:
  tag: "3px"
  control: "5px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 14px"
  button-disabled:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.control}"
  chip-needs-you:
    backgroundColor: "rgb(255 211 105 / 9%)"
    textColor: "{colors.state-amber}"
    rounded: "{rounded.tag}"
    height: "24px"
    padding: "0 8px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "14px"
---

# Design System: Stint

## Overview

Stint is a working tool for people who hand coding work to agents, so every screen answers four questions first: what needs me, what is running, what is ready or waiting, and what I can safely do next. The look is a calm charcoal workspace: near-black surfaces with a cool undertone, near-white ink, quiet tables, and colour kept for meaning. The UI follows the system's light or dark setting on the same tokens; dark is charcoal, the default, and the look the demo and the video use.

Every state reads in a word and a shape, never in colour alone. Amber means it needs you, mint green means verified evidence and nothing else, red means failed or stopped, and violet means a skill was learned. Merged and other closed outcomes are neutral.

One signature move stays: **the revision block**. A task's run history is set like a drawing's revision table: run, change, by (vendor ink and name), result. The approval row closes the block, with Approve and merge as its last control. The same heavy block holds the packet header and a skill's versions; every other table is quiet.

Copy is the product's own: task, run, packet, decision, finding, skill, verify, gate. Sentence case, present tense, plain words, and no metaphor vocabulary. On screen the daemon is "Stint".

## Colors

Charcoal is the dark theme, and the system setting picks light or dark (the light set is below). Charcoal is near-black surfaces with a cool blue undertone, stepped up in lightness from shell to panel-2, near-white ink, and borders that carry a little blue. The palette is the owner's (29 Oct brief), with one change: red.

- **Vendor inks** mark who did the work, on rail segments, run blocks, revision cells, and spend bars. They are small marks, never text, and always paired with a name.
- **State inks** carry meaning only: amber means it needs you or waits for approval, mint green means verified evidence and nothing else, red means failed or stopped, violet means a skill was learned. Merged, approved and other closed outcomes are neutral ink.
- A recommendation is not a state. It uses an ink-outline label, not green.
- **Red** is the owner's `#ffaaa2` deepened to the coral `#f2786f`. At the supplied value red and green were 9.3 apart under protanopia and 8.2 under deuteranopia (CIEDE2000); the coral takes them to 21.5 and 17.1, and red text still reads at 5.05:1 or better on every surface.

### Light theme

The system setting chooses the theme (R-067); there is no control. Light is paper and near-black ink on the same token names: shell `#f2f4f7`, ground `#fafbfc`, panel `#ffffff`, panel-2 `#eef2f6`, rule `#d9e0e8`, rule-strong `#748396`, field `#737f8f`, ink `#0d1218`, ink-2 `#2b3644`, ink-3 `#455161`; state inks amber `#8c5a00`, green `#07745a`, red `#8e1e1e`, violet `#6847cf`; vendor inks Meta `#1d6ad1`, Anthropic `#b0562a`, OpenAI `#10795a`, local `#5a6879`; focus `#1d6ad1`. The terminal stays dark in both themes.

Measured from tokens.css: every text ink reads at 4.5:1 or better on every surface it sits on (the lowest is green on a selected row, 4.87:1), ink-3 at 7.17:1 or better on shell, ground and panel, and every mark at 3:1. Red and green are 17.8 apart under protanopia and 17.1 under deuteranopia (CIEDE2000); amber and green share a lightness, so with no colour at all only the shapes tell them apart. axe finds no WCAG A or AA violation on the board, a task's tabs, Goals, the Factory or Skills in either theme (`e2e/a11y.spec.ts`).

### Contrast

Measured from tokens.css with `prefers-contrast` off:
- Every text ink passes 4.5:1 on every surface it sits on. ink is 12.4:1 or better, ink-2 8.9:1, ink-3 6.9:1 (7:1 or better everywhere but the selected row), amber, green and violet 8.5:1, and red 5.05:1 at its lowest, on the selected row. term-ink is 15.8:1 on the terminal.
- Every mark passes 3:1: rule-strong 3.04:1 at its lowest (selected row) and 3.38:1 on panel-2, field 3.69:1, focus 8.2:1, and each vendor ink 6.4:1 or better. rule is decoration only, never the edge a person must find.
- On-ink is 12.4:1 or better on ink, ink-2 and every vendor ink, so a primary button and a label on a spend bar read.
- `prefers-contrast: more` raises ink-2, ink-3, rule, rule-strong, field and focus.
- In Windows High Contrast (`forced-colors: active`), focus is a system-coloured outline, cards, tables, dialogs, inputs, status labels, buttons and notices keep a CanvasText border, the current page keeps a Highlight underline, and an attention edge becomes Highlight.

### Colour vision

Measured with CIEDE2000 on Machado 2009 simulations at full severity. The state inks sit close in lightness (amber L* 86, green 85, violet 82, red 64), so colour alone cannot carry them for everyone:
- red is at least 15 from every other state ink under protanopia, deuteranopia and tritanopia, and green and red are 15 apart with no colour at all;
- amber and green are 16.7 apart under protanopia and less than 1 apart with no colour; amber and violet are 19.8 apart under tritanopia;
- this is why no state rests on colour: every status label draws a shape beside its word (next section).

### Never by colour alone

Colour repeats what words or shapes already say (WCAG 1.4.1), so the screen reads the same in greys:

- every status label draws a 10 px shape before its word: a triangle needs you, a tick verified, a cross failed, a filled dot runs, a ring waits (planned, in PR review), a square is closed (merged, approved, finished), a bar was abandoned, a diamond was learned (`StateMark` in `ui.tsx`);
- a reached limit says ", reached" beside its bar;
- the diff marks each changed line with + or -, not only its wash;
- in the memory graph a decision is a square, a finding a diamond, a file a ring, a skill a named pill, and the rest are dots, with the same marks in the legend; a contradiction is a dashed line;
- a spend bar draws its parts in the legend's order with a gap between them, planning and review calls are a hollow box, and the cost legend says each host's spend in words;
- a vendor ink always sits beside the agent's or model's name.

## Typography

Geist and Geist Mono, bundled with the UI as `@fontsource-variable/geist` 5.3.0 and `@fontsource-variable/geist-mono` 5.3.0, so the UI never fetches a font. One family carries titles, labels, body, and data, with tabular figures everywhere. Mono is for IDs, paths, commands, packets, and diffs only.

| Role | Size and line height | Weight |
|---|---|---|
| Title | 24/30 | 600 |
| Section | 16/22 | 600 |
| Body | 14/20 | 400 |
| Small | 13/18 | 400 |
| Code | 13/20 | 400 |

Nothing is set below 12px.

## Layout

The spacing scale is 4, 8, 12, 16, 20, 24, 32 and 40px, and controls are 36px high. A page (`stint-page`) is at most 1440px wide and centred, with 40px gutters. Its header (`stint-page-header`) puts the title (26px) and a one-line summary, at most 75 characters wide, on the left, and the page's actions on the right.

- **Top bar** (`stint-topbar`, 64px): the Stint wordmark and the project name (cut short, with the full name in its title), then Board, Goals, Factory and Skills, the current one marked by an ink underline and `aria-current="page"`. Search, spend, the status button and Help sit on the right. Below 768px the nav takes its own row, so the bar fits a phone in two rows.
- **Board** (`stint-board`): a sentence that says what needs you, the counts, then four groups in order: Needs you, Planned, In progress, Closed. Four columns from 1200px, two from 768px, one below.
- **Task view:** the title block across the top, then the runs (340px from 1180px, 320px from 760px) beside the work area. Memory, 360px, opens as a third column on request (the Memory button, or m). Below 1180px memory drops under the work. Below 760px everything stacks, with the gate and the tabs before the runs.
- **Goals, Factory and Skills:** the same page header, then sections 32px apart, each with a 16px section title. The Factory keeps its figures at ordinary size, and its groups open on request.
- **Dialogs** (`stint-dialog`): 640px wide by default and 720px for the spec builder, Add skill and Help, never wider than the viewport less 32px, 8% down the page. The body scrolls; the footer stays in reach.
- Gutters drop to 24px below 1200px and 16px below 768px. No page scrolls sideways at 1440, 1280, 768 or 390px; code and wide tables scroll inside their own regions.

## Elevation & Depth

The surfaces are flat and step up in lightness: shell for the top bar, ground for the page, panel for cards, tables and dialogs, panel-2 above that. Depth comes from lines:
- a 1px rule between rows and around cards and notices;
- a 1px rule-strong border on controls and status labels, and on the revision block's cells, which an outer ink-3 line closes;
- a left edge on what asks for attention: 2px amber on a card that needs you, 3px on a notice (ink-3, amber for attention, red for an error), and an amber rule under the Needs you header.

A selected row or run takes the surface-selected fill and an inset rule-strong line. Only what floats above the page takes a shadow (`--shadow`): a dialog over a 75% shell scrim, the command palette, and the status button's panel.

## Shapes

Corners are nearly square:
- 3px on status labels, tags and key hints;
- 5px on buttons, inputs, cards, notices, tables and the palette;
- 8px on dialogs;
- 12px on the skill pill in the memory graph.

Every status label draws a 10px mark before its word (`StateMark` in `ui.tsx`): a triangle needs you, a tick verified, a cross failed, a filled dot runs, a ring waits, a square is closed, a bar was abandoned, a diamond was learned. A run's packet joint on the rail is a 12px square, red-edged when the run was killed or failed.

## Components

The `stint-*` classes in `styles.css` sit in Tailwind's components layer, so a utility on the same element wins and no rule needs `!important`.

- **Button** (`Button` in `ui.tsx`, `stint-button`): `primary` is filled near-white with ground text, `quiet` (the default) is outlined in rule-strong, `danger` is outlined and written in red, with a red wash on hover, and `ghost` has no border. A toggle shows its state through `aria-pressed` or `aria-selected` with the selected fill. `aria-disabled` stops the click as well as saying the state, and `aria-busy` marks a request in flight.
- **Status label** (`StatusChip`, `stint-status`): one word and its shape, 24px high, on the state's wash: attention (amber), verified (green), failed (red), learned (violet), active, recommend (an ink outline, since a recommendation is not a state), or neutral.
- **Notice** (`stint-notice`): a sentence and its action, with a left edge; attention and error variants carry the amber or red wash. It says why something is stopped, stale or looking back.
- **Task card** (`stint-task-card`): the title first with a small mono id, one status label, one summary or blocker line, the daemon's test result, then who, how long and what it cost. A card that needs you has one action.
- **Table**: an ordinary table is quiet, with a header row on panel and a rule between rows (`rev.table`, `stint-table`), figures right-aligned in tabular digits. `rev.block` is the heavy revision block, kept for history, provenance and approval.
- **Dialog** (`Dialog` in `Shell.tsx`): a header with the title and a visible Close, a body that scrolls, and a footer for its actions. Focus moves in, stays in, and returns where it was. With typed text, Escape, Close or a click outside turns the footer into "Discard this draft?" with Keep editing focused first.
- **Tabs**: ink-2 at rest, ink with a 2px ink underline when chosen.
- **Forms** (`stint-input`, `stint-field-*`): 38px fields with a label above, help or an error below, and `aria-invalid` drawn in red.
- **The run rail:** a 4px vendor-inked axis per run, which pulses while the run is live, with the square packet joint between runs showing the packet's token count.
- **The title block:** the task's id and title on one line, the state and the one next action on the right, then spend, runs, branch and the limit meters. A meter is used of cap with a bar, and turns amber with a triangle once its limit is reached.

Motion is small and carries meaning: a live run's axis pulses, a memory node fades over 220ms as the clock passes it, and hover colours change over 140ms. Each of these stops under `prefers-reduced-motion`.

## Do's and Don'ts

- Do answer what needs you first: a page leads with a sentence that names the task and the reason, or says nothing does.
- Do give every state a word and a shape; never let colour carry meaning alone.
- Do keep green for verified evidence only, and show closed outcomes in neutral ink.
- Do pair every vendor ink with the agent's or model's name.
- Do give every empty group or panel a sentence that says what will appear there, and keep loading, error, empty and filtered-empty apart.
- Do give every action that changes something a pending state, so a second press sends nothing, and keep what was typed when the daemon refuses.
- Do show one primary action per screen; a card never becomes a row of buttons.
- Do keep the code-review convention in a diff: a green wash and a + on added lines, a red wash and a - on removed ones. It is notation for code, not a state.
- Don't put an id above a heading; set it inline, small and mono, in the heading line.
- Don't use gradients, glass, decorative grids, giant rounded cards or oversized statistics.
- Don't add motion that carries no meaning.
- Don't rename product concepts with a metaphor.
