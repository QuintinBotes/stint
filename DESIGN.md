---
name: Stint
description: A drawing office for coding agents. Blueprint ground, linework ink, and one signature move, the revision block.
colors:
  shell: "#002745"
  ground: "#043051"
  panel: "#0b3a5f"
  panel-2: "#1b486d"
  rule: "#30597d"
  rule-strong: "#52789c"
  ink: "#eef3f8"
  ink-2: "#c0d1e2"
  ink-3: "#a9bfd6"
  vendor-meta: "#8fcaff"
  vendor-anthropic: "#f5ab7e"
  vendor-openai: "#74e3c3"
  vendor-local: "#d3dce5"
  state-amber: "#ffcb62"
  state-green: "#6ddc9c"
  state-red: "#ff958a"
  state-violet: "#cdb5ff"
  terminal: "#001d36"
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
    backgroundColor: "rgba(255,203,98,.13)"
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

Blueprint is the only look: Prussian blue ground (oklch 0.30 0.075 247) with surfaces stepped up in lightness on the same hue, and near-white linework ink.

- **Vendor inks** mark who did the work, on rail segments, run blocks, revision cells, and spend bars. They are always paired with a name, never alone.
- **State inks** carry meaning only: amber means it needs you, green means verified, red means stopped or killed, and violet means learned.
- A recommendation is not a state. It uses an ink-outline chip, not green.
- Every text ink passes 4.5:1 on ground, panel, and panel-2.

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
- Do keep the code-review convention in a diff: a green wash on added lines and a red wash on removed ones is notation for code, not a state.
