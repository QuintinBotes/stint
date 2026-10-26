# Stint task T-0001: Serve the audit log as JSON on request

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Let GET /audit answer JSON when the query says format=json: add a JSON view of the entries (the existing list in src/lib/audit.ts) and branch on the query in src/routes/audit.ts, keeping CSV as the default and keeping the X-Tenant filter in both formats. Add tests in test/audit.test.ts.

Acceptance:
- GET /audit?format=json returns the audit entries as JSON
- GET /audit without the query still returns CSV
- The X-Tenant header filters both formats
- The suite stays green with new tests for both formats

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Transcript of the previous run
User: # Stint task T-0001: Serve the audit log as JSON on request

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Let GET /audit answer JSON when the query says format=json: add a JSON view of the entries (the existing list in src/lib/audit.ts) and branch on the query in src/routes/audit.ts, keeping CSV as the default and keeping the X-Tenant filter in both formats. Add tests in test/audit.test.ts.

Acceptance:
- GET /audit?format=json returns the audit entries as JSON
- GET /audit without the query still returns CSV
- The X-Tenant header filters both formats
- The suite stays green with new tests for both formats

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Changes on the task branch so far
None yet.

## Ask
Implement the goal. Follow the plan where there is one.

Tool call: read_file {
  "path": "src/routes/audit.ts"
}

Tool call: read_file {
  "path": "src/lib/audit.ts"
}

Tool call: read_file {
  "path": "test/audit.test.ts"
}

Tool result (read_file):
Read text file `src/routes/audit.ts`.
1|import { Hono } from 'hono';
2|import type { Deps } from '../app';
3|
4|export function auditRoutes(deps: Deps): Hono {
5|  const r = new Hono();
6|
7|  r.get('/', (c) => {
8|    const tenant = c.req.header('X-Tenant') || undefined;
9|    c.header('Content-Type', 'text/csv; charset=utf-8');
10|    return c.body(deps.audit.toCsv(tenant));
11|  });
12|
13|  return r;
14|}

Tool result (read_file):
Read text file `src/lib/audit.ts`.
1|export interface AuditEntry {
2|  at: string;
3|  tenant: string;
4|  action: string;
5|  target: string;
6|}
7|
8|const EXPORT_LIMIT = 5000;
9|
10|function csvCell(value: string): string {
11|  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
12|}
13|
14|export class AuditLog {
15|  private entries: AuditEntry[] = [];
16|
17|  record(tenant: string, action: string, target: string, now = new Date()): AuditEntry {
18|    const entry = { at: now.toISOString(), tenant, action, target };
19|    this.entries.push(entry);
20|    return entry;
21|  }
22|
23|  list(tenant?: string): AuditEntry[] {
24|    return tenant === undefined ? [...this.entries] : this.entries.filter((e) => e.tenant === tenant);
25|  }
26|
27|  toCsv(tenant?: string): string {
28|    const rows = this.list(tenant).slice(-EXPORT_LIMIT);
29|    const lines = rows.map((e) => [e.at, e.tenant, e.action, e.target].map(csvCell).join(','));
30|    return ['at,tenant,action,target', ...lines].join('\n') + '\n';
31|  }
32|}

Tool result (read_file):
Read text file `test/audit.test.ts`.
1|import { describe, expect, it } from 'vitest';
2|import { setup } from './helpers';
3|
4|describe('GET /audit', () => {
5|  it('exports CSV with a header row', async () => {
6|    const { send } = setup();
7|    const res = await send('/audit');
8|    expect(res.headers.get('Content-Type')).toContain('text/csv');
9|    expect((await res.text()).split('\n')[0]).toBe('at,tenant,action,target');
10|  });
11|
12|  it('writes one row per audit entry', async () => {
13|    const { send, postWebhook } = setup();
14|    await postWebhook('tenant-a', { type: 'one' });
15|    await postWebhook('tenant-a', { type: 'two' });
16|    const lines = (await (await send('/audit')).text()).trim().split('\n');
17|    expect(lines).toHaveLength(3);
18|  });
19|
20|  it('carries the tenant on every row', async () => {
21|    const { send, postWebhook } = setup();
22|    await postWebhook('tenant-b', { type: 'one' });
23|    const row = (await (await send('/audit')).text()).trim().split('\n')[1] ?? '';
24|    expect(row.split(',').slice(1)).toEqual(['tenant-b', 'webhook.received', 'evt_000001']);
25|  });
26|
27|  it('filters the export by the X-Tenant header', async () => {
28|    const { send, postWebhook } = setup();
29|    await postWebhook('tenant-a', { type: 'one' });
30|    await postWebhook('tenant-b', { type: 'two' });
31|    const lines = (await (await send('/audit', { tenant: 'tenant-a' })).text()).trim().split('\n');
32|    expect(lines.slice(1).every((l) => l.includes(',tenant-a,'))).toBe(true);
33|    expect(lines).toHaveLength(2);
34|  });
35|});

Tool call: read_file {
  "path": "test/helpers.ts"
}

Tool call: read_file {
  "path": "src/config.ts"
}

Tool result (read_file):
Read text file `test/helpers.ts`.
1|import { createApp, createDeps, type Deps } from '../src/app';
2|import { type Config, loadConfig } from '../src/config';
3|
4|export function setup(overrides: Partial<Config> = {}) {
5|  const deps: Deps = createDeps({ ...loadConfig({}), ...overrides });
6|  const app = createApp(deps);
7|  const send = (path: string, init: RequestInit & { tenant?: string } = {}) => {
8|    const headers = new Headers(init.headers);
9|    if (init.tenant) headers.set('X-Tenant', init.tenant);
10|    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
11|    return app.request(path, { ...init, headers });
12|  };
13|  const postWebhook = (tenant: string, body: unknown) =>
14|    send('/webhooks', { method: 'POST', tenant, body: JSON.stringify(body) });
15|  return { deps, app, send, postWebhook };
16|}

Tool result (read_file):
Read text file `src/config.ts`.
1|export interface Config {
2|  port: number;
3|  maxBodyBytes: number;
4|  replayMaxAttempts: number;
5|  replayBaseDelayMs: number;
6|}
7|
8|type Env = Record<string, string | undefined>;
9|
10|function positiveInt(value: string | undefined, fallback: number): number {
11|  if (value === undefined || value.trim() === '') return fallback;
12|  const n = Number(value);
13|  return Number.isInteger(n) && n > 0 ? n : fallback;
14|}
15|
16|export function loadConfig(env: Env = process.env): Config {
17|  return {
18|    port: positiveInt(env.PORT, 3000),
19|    maxBodyBytes: positiveInt(env.MAX_BODY_BYTES, 65536),
20|    replayMaxAttempts: positiveInt(env.REPLAY_MAX_ATTEMPTS, 5),
21|    replayBaseDelayMs: positiveInt(env.REPLAY_BASE_DELAY_MS, 100),
22|  };
23|}

Tool call: read_file {
  "path": "src/routes/webhooks.ts"
}

Tool result (read_file):
Read text file `src/routes/webhooks.ts`.
1|import { Hono } from 'hono';
2|import type { Deps } from '../app';
3|
4|export function webhookRoutes(deps: Deps): Hono {
5|  const r = new Hono();
6|
7|  r.post('/', async (c) => {
8|    const tenant = c.req.header('X-Tenant');
9|    if (!tenant) return c.json({ error: 'missing X-Tenant header' }, 400);
10|    if (!deps.tenants.get(tenant)) return c.json({ error: `unknown tenant ${tenant}` }, 404);
11|
12|    const raw = await c.req.text();
13|    if (new TextEncoder().encode(raw).length > deps.config.maxBodyBytes) {
14|      return c.json({ error: 'payload too large' }, 413);
15|    }
16|
17|    let body: { type?: unknown; data?: unknown };
18|    try {
19|      body = JSON.parse(raw);
20|    } catch {
21|      return c.json({ error: 'body must be JSON' }, 400);
22|    }
23|    if (typeof body.type !== 'string' || body.type === '') {
24|      return c.json({ error: 'type is required' }, 400);
25|    }
26|
27|    const event = deps.store.add(tenant, body.type, body.data ?? null);
28|    deps.audit.record(tenant, 'webhook.received', event.id);
29|    return c.json(event, 202);
30|  });
31|
32|  return r;
33|}

Tool call: edit_file {
  "path": "src/routes/audit.ts"
}

Tool result (edit_file):
edited
changed lines: lines 7-11
--- original
+++ updated
@@
-  r.get('/', (c) => {
-    const tenant = c.req.header('X-Tenant') || undefined;
-    c.header('Content-Type', 'text/csv; charset=utf-8');
-    return c.body(deps.audit.toCsv(tenant));
-  });
+  r.get('/', (c) => {
+    const tenant = c.req.header('X-Tenant') || undefined;
+    if (c.req.query('format') === 'json') {
+      return c.json(deps.audit.list(tenant));
+    }
+    c.header('Content-Type', 'text/csv; charset=utf-8');
+    return c.body(deps.audit.toCsv(tenant));
+  });


Tool call: edit_file {
  "path": "test/audit.test.ts"
}

Tool result (edit_file):
edited
changed lines: lines 27-35
--- original
+++ updated
@@
-  it('filters the export by the X-Tenant header', async () => {
-    const { send, postWebhook } = setup();
-    await postWebhook('tenant-a', { type: 'one' });
-    await postWebhook('tenant-b', { type: 'two' });
-    const lines = (await (await send('/audit', { tenant: 'tenant-a' })).text()).trim().split('\n');
-    expect(lines.slice(1).every((l) => l.includes(',tenant-a,'))).toBe(true);
-    expect(lines).toHaveLength(2);
-  });
-});
+  it('filters the export by the X-Tenant header', async () => {
+    const { send, postWebhook } = setup();
+    await postWebhook('tenant-a', { type: 'one' });
+    await postWebhook('tenant-b', { type: 'two' });
+    const lines = (await (await send('/audit', { tenant: 'tenant-a' })).text()).trim().split('\n');
+    expect(lines.slice(1).every((l) => l.includes(',tenant-a,'))).toBe(true);
+    expect(lines).toHaveLength(2);
+  });
+
+  it('returns the entries as JSON when format=json', async () => {
+    const { send, postWebhook } = setup();
+    await postWebhook('tenant-a', { type: 'one' });
+    await postWebhook('tenant-b', { type: 'two' });
+    const res = await send('/audit?format=json');
+    expect(res.headers.get('Content-Type')).toContain('application/json');
+    const entries = await res.json();
+    expect(entries).toHaveLength(2);
+    expect(entries[0]).toMatchObject({ tenant: 'tenant-a', action: 'webhook.received' });
+  });
+
+  it('filters the JSON export by the X-Tenant header', async () => {
+    const { send, postWebhook } = setup();
+    await postWebhook('tenant-a', { type: 'one' });
+    await postWebhook('tenant-b', { type: 'two' });
+    const entries = await (await send('/audit?format=json', { tenant: 'tenant-a' })).json();
+    expect(entries).toHaveLength(1);
+    expect(entries[0]).toMatchObject({ tenant: 'tenant-a' });
+  });
+});


Tool call: bash {
  "command": "bun run test 2>&1 | tail -20 && bun run typecheck 2>&1 | tail -5"
}

Tool result (bash):
{
  "chunk_id": "exec-1-1",
  "command": "bun run test 2>&1 | tail -20 && bun run typecheck 2>&1 | tail -5",
  "description": "Run tests and typecheck",
  "exit_code": 0,
  "terminal_status": "completed",
  "output": "$ vitest run\n\n RUN  v3.2.7 <fixture>/.stint/worktrees/T-0001-r1\n\n ✓ test/backoff.test.ts (2 tests) 2ms\n ✓ test/config.test.ts (4 tests) 2ms\n ✓ test/admin.test.ts (5 tests) 10ms\n ✓ test/webhooks.test.ts (7 tests) 10ms\n ✓ test/events.test.ts (5 tests) 12ms\n ✓ test/audit.test.ts (6 tests) 14ms\n\n Test Files  6 passed (6)\n      Tests  29 passed (29)\n   Start at  19:09:49\n   Duration  579ms (transform 1.32s, setup 0ms, collect 1.61s, tests 50ms, environment 1ms, prepare 373ms)\n\n$ tsc --noEmit\ntest/audit.test.ts(44,12): error TS18046: 'entries' is of type 'unknown'.\ntest/audit.test.ts(53,12): error TS18046: 'entries' is of type 'unknown'.\n",
  "original_output_bytes": 717,
  "original_output_tokens": 180,
  "truncated": false
}

Tool call: edit_file {
  "path": "test/audit.test.ts"
}

Tool call: edit_file {
  "path": "test/audit.test.ts"
}

Tool result (edit_file):
edited
changed lines: lines 42-43
--- original
+++ updated
@@
-    const entries = await res.json();
-    expect(entries).toHaveLength(2);
+    const entries = (await res.json()) as Array<Record<string, unknown>>;
+    expect(entries).toHaveLength(2);


Tool result (edit_file):
edited
changed lines: lines 51-52
--- original
+++ updated
@@
-    const entries = await (await send('/audit?format=json', { tenant: 'tenant-a' })).json();
-    expect(entries).toHaveLength(1);
+    const entries = (await (
+      await send('/audit?format=json', { tenant: 'tenant-a' })
+    ).json()) as Array<Record<string, unknown>>;
+    expect(entries).toHaveLength(1);

## Changes on the task branch so far
- src/routes/audit.ts +3 -0
- test/audit.test.ts +22 -0

## Ask
Continue from the transcript: finish what it started.
