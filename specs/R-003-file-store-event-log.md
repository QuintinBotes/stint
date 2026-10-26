# R-003 · File store and event log

Day: 1 (27 Oct) · Owner: Q · Depends on: R-002 · Fallback: skip atomic rename, keep the chain · Cut: never

## Goal
The `.stint/` workspace as a library: create and read tasks, append events with a monotonic `seq` and a hash chain, write JSON atomically, and project the basic views (task bundle, latest packet, cost totals) from the log. The daemon (R-004) is the only caller; everything a user later sees is derived from these files.

## Context
Layout in `AGENTS.md` section 5. The hash chain is ported from an earlier terminal project's `block-engine/src/run.rs` (rows sealed with SHA-256 over NUL-separated canonical fields plus the previous hash, genesis = 64 zeros, `verify()` names the first broken row), into append-only JSONL instead of SQLite triggers.

## Requirements
1. MUST implement `packages/core/src/store/`: `Workspace.open(repoRoot)` (creates `.stint/` with `config.json` defaults if missing), `createTask({title, goal, acceptance, testCommand?})` returning `T-00NN` (zero-padded, next free), `readTask(id)`, `writeTask(id, patch)` (atomic: write temp, fsync, rename), `listTasks()`.
2. MUST implement `EventLog(taskDir)`: `append(event)` assigns `id` (ulid), `seq` (previous + 1), `ts`, `prev` (previous row's `hash` or genesis) and `hash` = sha256 of `seq\0ts\0task\0run\0adapter\0type\0canonicalJSON(payload)\0prev`; `read({since})`; `verify()` returning `{ ok, brokenAt?: seq }`; writes are serialised through one in-process queue per task, and the file is opened with `O_APPEND`.
3. MUST implement projections in `packages/core/src/project/`: `taskBundle(id)` → `{ task, plan, handoff, review, verification, runs[], cost }`; `costs({group: 'task'|'run'|'day'})`; `latestHandoff(id)`; all computed from files, no state.
4. MUST implement `decisions.md` append (`appendDecision(id, {text, supersedes?, evidence?, by})`) that never edits earlier entries and `readDecisions()` returning entries with `recordedAt` and `validTo` (set when superseded).
5. MUST write `runs/<run>/meta.json`, `prompt.md`, `transcript.jsonl` (transcript append-only) and `verification/<run>.json` through typed helpers; nothing else in the repo writes under `.stint/`.
6. MUST keep `.stint/` readable without Stint: pretty-printed JSON with stable key order, one event per line, decisions in markdown.
7. SHOULD expose `Workspace.watch(taskId, cb)` using `fs.watch` with a 50 ms debounce for the SSE route to use.

## Interfaces
```ts
export class Workspace { static open(root: string): Promise<Workspace>; createTask(i: NewTask): Promise<Task>; readTask(id): Promise<Task>; writeTask(id, patch: Partial<Task>): Promise<Task>; listTasks(): Promise<Task[]>; events(id): EventLog; decisions(id): DecisionLedger; runs(id): RunStore; verification(id): VerificationStore; }
export class EventLog { append(e: NewEvent): Promise<StintEvent>; read(o?: { since?: number }): Promise<StintEvent[]>; verify(): Promise<{ ok: boolean; brokenAt?: number }>; }
```
Config defaults (`.stint/config.json`): `{ version: 'stint.config/1', port: 0, adapters: {...}, budgets: { planner: 40000, implementer: 150000, reviewer: 30000, learn: 20000 }, testCommand: 'bun test', hosts: { 'meta-api': {...}, baseten: { baseURL: 'https://inference.baseten.co/v1', keyEnv: 'BASETEN_API_KEY', tpm: 2000000 }, fireworks: { baseURL: 'https://api.fireworks.ai/inference/v1', keyEnv: 'FIREWORKS_API_KEY' }, ollama: { baseURL: 'http://localhost:11434/v1' } }, routes: { planner: ['meta-api/muse-wonder-1.0', 'fireworks/muse-spark-open', 'baseten/muse-spark-open', 'ollama/muse-glimmer:30b-mlx'], reviewer: ['ollama/muse-glimmer:30b-mlx', 'fireworks/muse-spark-open', 'baseten/muse-spark-open'], learn: ['baseten/muse-spark-open', 'meta-api/muse-spark-1.3', 'ollama/muse-glimmer:30b-mlx'], summary: ['ollama/muse-glimmer:30b-mlx', 'baseten/muse-spark-open'] }, prices: { 'meta-api/muse-spark-1.3': { input: 1.25, cached: 0.15, output: 5 }, 'meta-api/muse-wonder-1.0': { input: 4, cached: 0.2, output: 20 }, 'baseten/muse-spark-open': { input: 1.25, cached: 0.15, output: 4.25 }, 'fireworks/muse-spark-open': { input: 1.25, cached: 0.15, output: 4.25 }, 'ollama/muse-glimmer:30b-mlx': { input: 0, cached: 0, output: 0 } }, credits: { baseten: 100, fireworks: 25, 'meta-api': 150 } }` (USD per million, keyed by `host/model`; `credits` are the partner and hackathon balances the human enters, decremented by metered spend).

## Acceptance
1. 1,000 concurrent `append` calls from 8 async producers produce 1,000 lines, `seq` 1..1000 with no gaps, and `verify()` is ok: `packages/core/test/eventlog.concurrency.test.ts`.
2. Flipping one byte in line 500 makes `verify()` return `{ ok: false, brokenAt: 500 }`: `packages/core/test/eventlog.chain.test.ts`.
3. Killing the process (simulated by throwing) between temp write and rename leaves the previous `task.json` intact: `packages/core/test/store.atomic.test.ts`.
4. `taskBundle` on a seeded task dir equals the expected JSON fixture: `packages/core/test/project.bundle.test.ts`.
5. A superseding decision sets `validTo` on the superseded one and both remain in the file: `packages/core/test/decisions.test.ts`.

## Verify
```
bun test packages/core
```

## Out of scope
HTTP (R-004), worktrees (R-005), the graph (R-018).

## Notes
Use `ulid` for ids and `node:crypto` for sha256. Canonical JSON = keys sorted recursively, no whitespace. Keep the per-task queue in memory; the daemon is a single process. The watch helper is best-effort; the SSE route also polls `seq` every second as a fallback.
