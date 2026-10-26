# R-008 · PTY and terminal pane

Day: 2 (28 Oct) · Owner: Q · Depends on: R-004, R-005 · Fallback: an "Open in terminal" button that copies `cd .stint/worktrees/<task>-<run>` · Cut order: 3

## Goal
A real shell in the run's worktree inside the task view, so the kill beat happens on camera from Stint itself and a person can type next to the agent. Daemon-owned PTY, one per task view, raw bytes over a WebSocket, xterm.js 6 in the UI.

## Context
an earlier terminal project's PTY pipeline (`terminal-core/src/pty.rs`, `osc.rs`) is the prior art; Stint re-implements the minimal design: spawn, write, resize, data, kill. The coalescing pump, DEC 2026 hold and OSC tap are post-hackathon. D-004: `TERM_PROGRAM=Stint`, no OSC 7373.

## Requirements
1. MUST implement `packages/daemon/src/pty.ts` with one interface `Pty { spawn(opts: { cwd, env, cols, rows, shell? }): PtyHandle; }` and `PtyHandle { write(data: Uint8Array): void; resize(cols, rows): void; onData(cb): void; onExit(cb): void; kill(signal?): void; pid: number }`, backed by `Bun.Terminal` first and `bun-pty` as a fallback chosen at runtime with the choice reported in `/api/health`.
2. MUST add `GET /api/tasks/:id/pty` (WebSocket upgrade, token in the `Sec-WebSocket-Protocol` header or query) that opens the login shell in the task's active worktree with the run's environment (`STINT_TASK`, `STINT_RUN`, `STINT_WORKTREE`, `TERM_PROGRAM=Stint`, `TERM=xterm-256color`, `COLORTERM=truecolor`) and session markers stripped; frames: binary = terminal bytes both ways, text JSON = `{ "resize": [cols, rows] }` or `{ "kill": true }`.
3. MUST record a `human.command` event for each line the person submits (detected on Enter, the typed line captured before it is sent, trimmed, ≤ 2 KB), so the timeline shows what the person did beside what the agent did.
4. MUST implement the Terminal tab in the task view: `@xterm/xterm` 6 with the fit and WebGL addons (DOM renderer fallback inside WebViews), Geist Mono 12.5 px, `terminal-ground` and `terminal-ink` tokens in every theme, a "Kill run ⌘." button that calls `POST /api/tasks/:id/runs/:run/stop` (the route lands in R-012; until then it sends `kill` to the PTY), and a "copy cd" fallback button.
5. MUST close the PTY when the task view unmounts or the task has no worktree, and refuse to open one (`not_found`) when there is no worktree.
6. SHOULD limit one PTY per task per client and reap the shell on daemon exit.

## Interfaces
- WebSocket at `/api/tasks/:id/pty?token=…`; first text frame from the server `{ "ready": true, "backend": "bun-terminal" | "bun-pty", "cwd": "…" }`.

## Acceptance
1. On macOS and Linux (CI), opening the PTY route on the fixture's worktree and sending `ls\n` returns output containing `package.json` within 2 s: `packages/daemon/test/pty.test.ts`.
2. Sending `{ "resize": [120, 40] }` is reflected by `stty size` output: same file.
3. Typing `echo hi` and Enter produces a `human.command` event with `payload.command: "echo hi"`: same file.
4. The Terminal tab renders, fits its pane, and the kill button is visible while a run is active: `apps/web/e2e/terminal.spec.ts`.
5. `/api/health` reports the PTY backend chosen: `packages/daemon/test/health.test.ts`.

## Verify
```
bun test packages/daemon
bun run test:ui
```

## Out of scope
Blocks (command segmentation), OSC parsing, scrollback persistence, SSH.

## Notes
Never JSON-wrap terminal bytes; send binary frames. `Bun.Terminal` exists from Bun 1.3.5; check `typeof Bun.Terminal` and fall back. The `human.command` capture is a simple line buffer on the server side of the socket; it does not need to be perfect for the demo, only honest (`payload.approximate: true` when a control sequence confused it).
