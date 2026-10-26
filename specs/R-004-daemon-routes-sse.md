# R-004 · Daemon routes and SSE

Day: 1 (27 Oct) · Owner: CC · Depends on: R-003 · Fallback: polling instead of SSE · Cut: never

## Goal
One Hono app on Bun that is the only process touching `.stint/`: REST for every state change, SSE for every event, a bearer token, a health route that tells the truth about adapters, and static serving of the built web UI. The CLI and the UI are thin clients of exactly these routes.

## Context
Route table in `AGENTS.md` section 5 and the spec doc's Daemon API. The honesty rules for `/api/health` come from an earlier terminal project: an adapter is reported with its capability level and gate strength, and an unreachable one says why.

## Requirements
1. MUST start with `stint up` (R-004 ships a minimal `packages/cli` entry `stint up [--port N] [--open]`) on `127.0.0.1` only, pick a free port when 0, write `.stint/cache/daemon.json` `{ port, token, pid, startedAt, version }` (mode 0600), and remove it on exit.
2. MUST implement: `GET /api/health`, `GET /api/tasks`, `POST /api/tasks`, `GET /api/tasks/:id`, `GET /api/tasks/:id/events?since=`, `GET /api/tasks/:id/stream` (SSE, `id:` = seq, `heartbeat` every 15 s, resumes from `Last-Event-ID`), `GET /api/stream` (board-level), `GET /api/costs?group=`. Mutating routes require `Authorization: Bearer <token>`; GETs on localhost do not.
3. MUST return errors as `{ error: { code, message, hint } }` with codes `dirty_tree`, `budget_exceeded`, `adapter_unavailable`, `capability_mismatch`, `run_active`, `not_found`, `unauthorized`, `invalid` (zod issues in `hint`).
4. MUST register adapters from `config.json` and call `available()` at start and on `/api/health`, reporting `{ id, vendor, roles, capability: CapabilityLevel, gate: GateStrength, version?, reason? }` per adapter; R-004 ships a `replay` adapter stub (used by R-006) and `null` entries for the three real ones until their specs land.
5. MUST serve `apps/web/dist` at `/` when it exists, with SPA fallback, and `GET /api/health` must work without it.
6. MUST log one JSON line per request to stderr (`{ ts, method, path, status, ms }`) and never log the token.
7. SHOULD expose `POST /api/tasks/:id/events` for the replay adapter and tests to append events directly (token required, refused unless `config.allowDirectEvents` is true or `NODE_ENV=test`).

## Interfaces
- `packages/daemon/src/app.ts` exports `createApp(ws: Workspace, adapters: Adapter[]): Hono`; `packages/daemon/src/server.ts` starts it. Tests use `app.request()` without a socket.
- SSE event shape: `event: <type>\nid: <seq>\ndata: <StintEvent JSON>\n\n`.

## Acceptance
1. `POST /api/tasks` then `GET /api/tasks/:id/stream` receives `task.created` within 200 ms: `packages/daemon/test/sse.test.ts`.
2. Reconnecting with `Last-Event-ID: 3` receives seq 4 onward only: same file.
3. A mutating call without the token gets 401 `unauthorized`; with it, 2xx: `packages/daemon/test/auth.test.ts`.
4. `/api/health` with no adapters configured lists each as `capability.level: 'unsupported'` with a reason, never omits one: `packages/daemon/test/health.test.ts`.
5. `daemon.json` is written with mode 0600 and removed on SIGTERM: `packages/daemon/test/lifecycle.test.ts`.

## Verify
```
bun test packages/daemon
bun run --cwd packages/cli build && ./packages/cli/bin/stint up --check
```

## Out of scope
Assign, stop, handoff, verify, approve routes (R-005, R-012, R-017), the PTY (R-008), the graph routes (R-018).

## Notes
Hono's `streamSSE` handles heartbeats; use the workspace `watch` from R-003 plus a 1 s `seq` poll fallback. Keep the app factory free of `Bun.serve` so tests are fast. `stint up` prints the URL and copies it to the clipboard when `--open` is given (macOS `pbcopy`, Linux `xclip` if present, otherwise just prints).
