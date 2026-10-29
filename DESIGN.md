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

Stint is a working tool, so the screens are a standard agent workspace first: board lanes by state, a task view with a run rail, tabs, and a memory panel, a command palette, and plain tables. The world is a drawing office, and it lends exactly four things: the blueprint palette, technical type, drawing-sheet density, and one signature move.

**The revision block.** A task is a drawing that many hands revise. Its run history is set like a drawing's revision table: run, change, by (vendor ink plus name), daemon check. The approval row closes the block, with Approve and merge as its last cell. The same block is the packet header (a title-block key and value table) and a skill's version history. The task header is the drawing's title block: ID and title on one line, then a field strip for state, spend, and runs, then the limit meters.

Copy is the product's own: task, run, packet, decision, finding, skill, verify, gate. Sentence case, present tense, and no metaphor vocabulary.

## Colors

Charcoal is the only look: near-black surfaces with a cool blue undertone, stepped up in lightness from shell to panel-2, near-white ink, and borders that carry a little blue. The palette is the owner's (29 Oct brief), with one change: red.

- **Vendor inks** mark who did the work, on rail segments, run blocks, revision cells, and spend bars. They are small marks, never text, and always paired with a name.
- **State inks** carry meaning only: amber means it needs you or waits for approval, mint green means verified evidence and nothing else, red means failed or stopped, violet means a skill was learned. Merged, approved and other closed outcomes are neutral ink.
- A recommendation is not a state. It uses an ink-outline label, not green.
- **Red** is the owner's `#ffaaa2` deepened to the coral `#f2786f`. At the supplied value red and green were 9.3 apart under protanopia and 8.2 under deuteranopia (CIEDE2000); the coral takes them to 21.5 and 17.1, and red text still reads at 5.05:1 or better on every surface.

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

The 8px grid has 36px controls and 36px rows.

- **Task view:** title block across the top, then two columns: rail 320 and work area fluid. Memory, 360, opens as a third column on request (the Memory button, or m).
- **Below 1180px**, memory drops under the work area.
- **Below 760px**, everything stacks in reading order: title block, runs, work, memory. Gutters are 16px, and the topbar becomes wordmark, nav, a Search button, and one health line.
- **Board:** lanes use auto-fit columns of at least 200px, with Needs you first.

## Elevation & Depth

The surfaces are flat. Depth comes from line weight, as on a drawing:
- a hairline 1px rule between rows;
- a 1px rule-strong border on blocks;
- a second, outer ink-3 line on the revision block and title block, the heavy object line.

Only two things take a soft shadow:
- the pinned approval row, which sits above the rail;
- the command palette, which sits above the page.

## Shapes

Corners are nearly square:
- 3px on tags and chips;
- 5px on controls, cards, and panels;
- 12px on the skill pill in the memory graph.

## Components

These are standard controls: button (primary ink-filled, secondary outlined, disabled panel-2), tabs with a 2px ink underline, chips, a native select, a range input, a textarea, and tables.

Signature components:
- **The revision block.** A bordered table with a pinned approval row.
- **The run rail.** A 4px vendor-inked axis per run, with a square packet joint between runs that shows the token count.
- **The title block.** The task's ID and title, with a field strip for state, spend, and runs, and a row of limit meters under it. A meter is used of cap with a square bar, and turns amber once its limit is reached.

Opacity changes driven by the scrubber fade over 220ms ease-out. That motion is off under prefers-reduced-motion.

## Do's and Don'ts

- Do keep navigation, controls, and layout standard; the world only supplies palette, type, density, and the revision block.
- Do pair every vendor ink with the vendor's name.
- Do give every empty panel a sentence that says what will appear there.
- Don't put a label or ID above a heading; put the ID inline in the heading line.
- Don't add drafting texture, grid paper, or sheet borders with zone letters; that is a costume of the world.
- Don't use green for anything but verified.
- Don't rename product concepts with a metaphor.
- Do keep the code-review convention in a diff: a green wash and a + on added lines, a red wash and a - on removed ones, is notation for code, not a state.
- Don't let a colour carry meaning on its own; say it in a word or a shape too.
