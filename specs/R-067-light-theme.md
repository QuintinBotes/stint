# R-067 · A light theme that follows the system

Day: 5 (30 Oct) · Owner: CC · Depends on: R-065 · Fallback: none (the charcoal theme stays the only look) · Cut order: 4

## Goal
The owner asked on 29 Oct for light and dark, following the system setting, because some people with low vision read dark text on a light page more easily, and others the reverse. R-065 made the charcoal dark theme; this spec adds its light counterpart on the same semantic tokens, chosen automatically from `prefers-color-scheme`, with no theme control (one fewer setting to find, and the look test keeps asserting there is no control).

## Requirements
1. A second token set in `tokens.css` under `@media (prefers-color-scheme: light)`: paper surfaces stepped down in lightness from ground to panel-2, near-black ink, and darker state and vendor inks so they read on paper. Same token names; no component changes colour by name.
2. The terminal stays dark in both themes (code and terminal output read as a terminal); its tokens are not overridden.
3. `color-scheme` follows the theme, so native controls, scrollbars and form fields match.
4. Contrast in the light theme, measured: every text ink 4.5:1 on every surface it sits on, ink-3 7:1 on ground and panel, every mark (rule-strong, field, focus, a vendor ink, a meter's fill) 3:1. `prefers-contrast: more` raises the secondary inks and lines in the light theme too.
5. Colour vision in the light theme: every state label keeps its shape; red and green at least 15 apart (CIEDE2000) under protanopia and deuteranopia.
6. Forced colours: unchanged (system colours win in either theme).
7. No literal colour in a component: a grep for hex, `rgb(` and `hsl(` in `apps/web/src/**/*.tsx` and `*.ts` finds nothing outside tokens, so both themes reach every pixel.

## Acceptance
1. A browser test emulates `prefers-color-scheme: light` and `dark` and checks the body background and ink on the board, a task and the Factory; the existing look test still finds no theme control.
2. The measurement script reports zero text and mark misses for the light set, with and without `prefers-contrast: more`.
3. Screenshots of every route at the four R-065 sizes in the light theme; no overflow; the terminal is dark in both.
4. DESIGN.md gives the light palette with its measured contrast. `bash scripts/check.sh` and `bun run test:ui` pass.
