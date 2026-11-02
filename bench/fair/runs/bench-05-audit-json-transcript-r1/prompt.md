# Stint task T-0001: Serve the audit log as JSON on request

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
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
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
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

Tool call: read_file {
  "path": "src/app.ts"
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

Tool result (read_file):
Read text file `src/app.ts`.
1|import { Hono } from 'hono';
2|import { type Config, loadConfig } from './config';
3|import { AuditLog } from './lib/audit';
4|import { EventStore } from './lib/store';
5|import { TenantRegistry } from './lib/tenants';
6|import { adminRoutes } from './routes/admin';
7|import { auditRoutes } from './routes/audit';
8|import { eventRoutes } from './routes/events';
9|import { webhookRoutes } from './routes/webhooks';
10|
11|export interface Deps {
12|  config: Config;
13|  store: EventStore;
14|  tenants: TenantRegistry;
15|  audit: AuditLog;
16|}
17|
18|export function createDeps(config: Config = loadConfig()): Deps {
19|  return {
20|    config,
21|    store: new EventStore(),
22|    tenants: new TenantRegistry([
23|      { id: 'tenant-a', name: 'Tenant A' },
24|      { id: 'tenant-b', name: 'Tenant B' },
25|    ]),
26|    audit: new AuditLog(),
27|  };
28|}
29|
30|export function createApp(deps: Deps = createDeps()): Hono {
31|  const app = new Hono();
32|  app.get('/health', (c) => c.json({ ok: true }));
33|  app.route('/webhooks', webhookRoutes(deps));
34|  app.route('/events', eventRoutes(deps));
35|  app.route('/admin', adminRoutes(deps));
36|  app.route('/audit', auditRoutes(deps));
37|  return app;
38|}

Tool call: read_file {
  "path": "test/helpers.ts"
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

Tool call: read_file {
  "path": "src/routes/events.ts"
}

Tool call: read_file {
  "path": "src/routes/webhooks.ts"
}

Tool call: read_file {
  "path": "src/routes/admin.ts"
}

Tool call: read_file {
  "path": "src/config.ts"
}

Tool result (read_file):
Read text file `src/routes/events.ts`.
1|import { Hono } from 'hono';
2|import type { Deps } from '../app';
3|import { backoffMs } from '../lib/backoff';
4|
5|export function eventRoutes(deps: Deps): Hono {
6|  const r = new Hono();
7|
8|  r.get('/', (c) => {
9|    const tenant = c.req.header('X-Tenant');
10|    if (!tenant) return c.json({ error: 'missing X-Tenant header' }, 400);
11|    return c.json({ events: deps.store.listByTenant(tenant) });
12|  });
13|
14|  r.post('/:id/replay', (c) => {
15|    const tenant = c.req.header('X-Tenant');
16|    if (!tenant) return c.json({ error: 'missing X-Tenant header' }, 400);
17|    const event = deps.store.get(c.req.param('id'));
18|    if (!event || event.tenant !== tenant) return c.json({ error: 'event not found' }, 404);
19|    if (event.attempts >= deps.config.replayMaxAttempts) {
20|      return c.json({ error: `replay limit of ${deps.config.replayMaxAttempts} reached` }, 409);
21|    }
22|
23|    const attempts = event.attempts + 1;
24|    const updated = deps.store.update(event.id, { attempts, status: 'replayed' });
25|    deps.audit.record(tenant, 'webhook.replayed', event.id);
26|    return c.json({ event: updated, delayMs: backoffMs(attempts, deps.config.replayBaseDelayMs) });
27|  });
28|
29|  return r;
30|}

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

Tool result (read_file):
Read text file `src/routes/admin.ts`.
1|import { Hono } from 'hono';
2|import type { Deps } from '../app';
3|import { TenantError } from '../lib/tenants';
4|
5|export function adminRoutes(deps: Deps): Hono {
6|  const r = new Hono();
7|
8|  r.get('/tenants', (c) => c.json({ tenants: deps.tenants.list() }));
9|
10|  r.post('/tenants', async (c) => {
11|    const body = await c.req.json<{ id?: unknown; name?: unknown }>().catch(() => ({}) as Record<string, unknown>);
12|    if (typeof body.id !== 'string' || typeof body.name !== 'string') {
13|      return c.json({ error: 'id and name are required' }, 400);
14|    }
15|    try {
16|      const tenant = deps.tenants.create(body.id, body.name);
17|      deps.audit.record(tenant.id, 'tenant.created', tenant.id);
18|      return c.json(tenant, 201);
19|    } catch (err) {
20|      if (err instanceof TenantError) return c.json({ error: err.message }, err.code === 'exists' ? 409 : 400);
21|      throw err;
22|    }
23|  });
24|
25|  return r;
26|}

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

Tool call: search

Tool result (search):
test/webhooks.test.ts:41:  it('writes an audit entry for each accepted event', async () => {
test/webhooks.test.ts:44:    expect(deps.audit.list()).toMatchObject([{ tenant: 'tenant-a', action: 'webhook.received', target: 'evt_000001' }]);
test/audit.test.ts:4:describe('GET /audit', () => {
test/audit.test.ts:7:    const res = await send('/audit');
test/audit.test.ts:12:  it('writes one row per audit entry', async () => {
test/audit.test.ts:16:    const lines = (await (await send('/audit')).text()).trim().split('\n');
test/audit.test.ts:23:    const row = (await (await send('/audit')).text()).trim().split('\n')[1] ?? '';
test/audit.test.ts:31:    const lines = (await (await send('/audit', { tenant: 'tenant-a' })).text()).trim().split('\n');
README.md:3:Receives webhooks per tenant, stores them in memory, replays them on request and keeps an audit log with a CSV export. See `AGENTS.md` for the layout and conventions.
AGENTS.md:3:A small Hono service on Bun. Webhooks come in per tenant, are stored in memory, can be replayed, and every action lands in an audit log that exports as CSV.
AGENTS.md:9:- `src/routes/` holds one file per route group: `webhooks.ts`, `events.ts`, `admin.ts`, `audit.ts`. Handlers stay thin and call into `src/lib/`.
AGENTS.md:10:- `src/lib/` holds the logic: `store.ts` (events), `tenants.ts`, `audit.ts`, `backoff.ts`.
AGENTS.md:17:- Every state change writes an audit entry with the tenant.
src/app.ts:3:import { AuditLog } from './lib/audit';
src/app.ts:7:import { auditRoutes } from './routes/audit';
src/app.ts:15:  audit: AuditLog;
src/app.ts:26:    audit: new AuditLog(),
src/app.ts:36:  app.route('/audit', auditRoutes(deps));
src/routes/webhooks.ts:28:    deps.audit.record(tenant, 'webhook.received', event.id);
src/routes/admin.ts:17:      deps.audit.record(tenant.id, 'tenant.created', tenant.id);
src/routes/events.ts:25:    deps.audit.record(tenant, 'webhook.replayed', event.id);
src/routes/audit.ts:4:export function auditRoutes(deps: Deps): Hono {
src/routes/audit.ts:10:    return c.body(deps.audit.toCsv(tenant));

Tool call: read_file {
  "path": "test/events.test.ts"
}

Tool call: read_file {
  "path": "test/webhooks.test.ts"
}

Tool result (read_file):
Read text file `test/events.test.ts`.
1|import { describe, expect, it } from 'vitest';
2|import { setup } from './helpers';
3|
4|describe('events', () => {
5|  it('lists only the calling tenant\'s events', async () => {
6|    const { postWebhook, send } = setup();
7|    await postWebhook('tenant-a', { type: 'a.one' });
8|    await postWebhook('tenant-b', { type: 'b.one' });
9|    const res = await send('/events', { tenant: 'tenant-a' });
10|    const body = (await res.json()) as { events: Array<{ type: string }> };
11|    expect(body.events.map((e) => e.type)).toEqual(['a.one']);
12|  });
13|
14|  it('requires the X-Tenant header to list events', async () => {
15|    const { send } = setup();
16|    expect((await send('/events')).status).toBe(400);
17|  });
18|
19|  it('replays an event and returns the backoff delay', async () => {
20|    const { postWebhook, send } = setup();
21|    await postWebhook('tenant-a', { type: 'a.one' });
22|    const first = await (await send('/events/evt_000001/replay', { method: 'POST', tenant: 'tenant-a' })).json();
23|    const second = await (await send('/events/evt_000001/replay', { method: 'POST', tenant: 'tenant-a' })).json();
24|    expect(first).toMatchObject({ event: { attempts: 1, status: 'replayed' }, delayMs: 100 });
25|    expect(second).toMatchObject({ event: { attempts: 2 }, delayMs: 200 });
26|  });
27|
28|  it('does not replay another tenant\'s event', async () => {
29|    const { postWebhook, send } = setup();
30|    await postWebhook('tenant-a', { type: 'a.one' });
31|    const res = await send('/events/evt_000001/replay', { method: 'POST', tenant: 'tenant-b' });
32|    expect(res.status).toBe(404);
33|  });
34|
35|  it('stops replaying after the configured number of attempts', async () => {
36|    const { postWebhook, send } = setup({ replayMaxAttempts: 2 });
37|    await postWebhook('tenant-a', { type: 'a.one' });
38|    const replay = () => send('/events/evt_000001/replay', { method: 'POST', tenant: 'tenant-a' });
39|    await replay();
40|    await replay();
41|    expect((await replay()).status).toBe(409);
42|  });
43|});

Tool result (read_file):
Read text file `test/webhooks.test.ts`.
1|import { describe, expect, it } from 'vitest';
2|import { setup } from './helpers';
3|
4|describe('POST /webhooks', () => {
5|  it('accepts an event for a known tenant', async () => {
6|    const { postWebhook } = setup();
7|    const res = await postWebhook('tenant-a', { type: 'invoice.paid', data: { amount: 10 } });
8|    expect(res.status).toBe(202);
9|    const body = await res.json();
10|    expect(body).toMatchObject({ id: 'evt_000001', tenant: 'tenant-a', type: 'invoice.paid', attempts: 0 });
11|  });
12|
13|  it('rejects a request without the X-Tenant header', async () => {
14|    const { send } = setup();
15|    const res = await send('/webhooks', { method: 'POST', body: JSON.stringify({ type: 'x' }) });
16|    expect(res.status).toBe(400);
17|  });
18|
19|  it('rejects an unknown tenant', async () => {
20|    const { postWebhook } = setup();
21|    expect((await postWebhook('nobody', { type: 'x' })).status).toBe(404);
22|  });
23|
24|  it('rejects a body that is not JSON', async () => {
25|    const { send } = setup();
26|    const res = await send('/webhooks', { method: 'POST', tenant: 'tenant-a', body: 'not json' });
27|    expect(res.status).toBe(400);
28|  });
29|
30|  it('rejects an event without a type', async () => {
31|    const { postWebhook } = setup();
32|    expect((await postWebhook('tenant-a', { data: 1 })).status).toBe(400);
33|  });
34|
35|  it('rejects a payload over the configured size', async () => {
36|    const { postWebhook } = setup({ maxBodyBytes: 32 });
37|    const res = await postWebhook('tenant-a', { type: 'big', data: 'x'.repeat(64) });
38|    expect(res.status).toBe(413);
39|  });
40|
41|  it('writes an audit entry for each accepted event', async () => {
42|    const { postWebhook, deps } = setup();
43|    await postWebhook('tenant-a', { type: 'invoice.paid' });
44|    expect(deps.audit.list()).toMatchObject([{ tenant: 'tenant-a', action: 'webhook.received', target: 'evt_000001' }]);
45|  });
46|});

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
+  it('still returns CSV without the format query', async () => {
+    const { send, postWebhook } = setup();
+    await postWebhook('tenant-a', { type: 'one' });
+    const res = await send('/audit');
+    expect(res.headers.get('Content-Type')).toContain('text/csv');
+    expect((await res.text()).split('\n')[0]).toBe('at,tenant,action,target');
+  });
+
+  it('returns the entries as JSON when format=json', async () => {
+    const { send, postWebhook } = setup();
+    await postWebhook('tenant-a', { type: 'one' });
+    await postWebhook('tenant-b', { type: 'two' });
+    const res = await send('/audit?format=json');
+    expect(res.headers.get('Content-Type')).toContain('application/json');
+    const body = (await res.json()) as Array<{ tenant: string; action: string; target: string }>;
+    expect(body).toHaveLength(2);
+    expect(body[0]).toMatchObject({ tenant: 'tenant-a', action: 'webhook.received', target: 'evt_000001' });
+    expect(body[1]).toMatchObject({ tenant: 'tenant-b', action: 'webhook.received', target: 'evt_000002' });
+  });
+
+  it('filters the JSON export by the X-Tenant header', async () => {
+    const { send, postWebhook } = setup();
+    await postWebhook('tenant-a', { type: 'one' });
+    await postWebhook('tenant-b', { type: 'two' });
+    const res = await send('/audit?format=json', { tenant: 'tenant-a' });
+    const body = (await res.json()) as Array<{ tenant: string }>;
+    expect(body).toHaveLength(1);
+    expect(body[0]?.tenant).toBe('tenant-a');
+  });
+});

## Changes on the task branch so far
- src/routes/audit.ts +3 -0
- test/audit.test.ts +30 -0

## Ask
Continue from the transcript: finish what it started.
