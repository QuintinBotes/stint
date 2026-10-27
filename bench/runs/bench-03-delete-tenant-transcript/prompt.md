# Stint task T-0001: Delete a tenant through the admin routes

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Add DELETE /admin/tenants/:id: add a remove method to TenantRegistry in src/lib/tenants.ts, call it from src/routes/admin.ts, answer 404 for an unknown tenant, and write an audit entry for the deletion like the other admin writes. A deleted tenant must no longer be accepted by POST /webhooks. Add tests in test/admin.test.ts.

Acceptance:
- DELETE /admin/tenants/:id removes a known tenant and answers 404 for an unknown one
- The deletion writes an audit entry with the tenant
- POST /webhooks answers 404 for the deleted tenant
- The suite stays green with new tests for the delete path

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Transcript of the previous run
User: # Stint task T-0001: Delete a tenant through the admin routes

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Add DELETE /admin/tenants/:id: add a remove method to TenantRegistry in src/lib/tenants.ts, call it from src/routes/admin.ts, answer 404 for an unknown tenant, and write an audit entry for the deletion like the other admin writes. A deleted tenant must no longer be accepted by POST /webhooks. Add tests in test/admin.test.ts.

Acceptance:
- DELETE /admin/tenants/:id removes a known tenant and answers 404 for an unknown one
- The deletion writes an audit entry with the tenant
- POST /webhooks answers 404 for the deleted tenant
- The suite stays green with new tests for the delete path

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Changes on the task branch so far
None yet.

## Ask
Implement the goal. Follow the plan where there is one.

Tool call: read_file {
  "path": "src/lib/tenants.ts"
}

Tool call: read_file {
  "path": "src/routes/admin.ts"
}

Tool call: read_file {
  "path": "test/admin.test.ts"
}

Tool call: read_file {
  "path": "src/app.ts"
}

Tool result (read_file):
Read text file `src/lib/tenants.ts`.
1|export interface Tenant {
2|  id: string;
3|  name: string;
4|  createdAt: string;
5|}
6|
7|const TENANT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
8|
9|export class TenantError extends Error {
10|  constructor(
11|    message: string,
12|    readonly code: 'invalid' | 'exists',
13|  ) {
14|    super(message);
15|  }
16|}
17|
18|export class TenantRegistry {
19|  private tenants = new Map<string, Tenant>();
20|
21|  constructor(seed: Array<Pick<Tenant, 'id' | 'name'>> = []) {
22|    for (const t of seed) this.create(t.id, t.name);
23|  }
24|
25|  list(): Tenant[] {
26|    return [...this.tenants.values()];
27|  }
28|
29|  get(id: string): Tenant | undefined {
30|    return this.tenants.get(id);
31|  }
32|
33|  create(id: string, name: string, now = new Date()): Tenant {
34|    if (!TENANT_ID.test(id)) throw new TenantError('id must be lowercase letters, digits and dashes', 'invalid');
35|    if (name.trim() === '') throw new TenantError('name is required', 'invalid');
36|    if (this.tenants.has(id)) throw new TenantError(`tenant ${id} exists`, 'exists');
37|    const tenant = { id, name: name.trim(), createdAt: now.toISOString() };
38|    this.tenants.set(id, tenant);
39|    return tenant;
40|  }
41|}

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
Read text file `test/admin.test.ts`.
1|import { describe, expect, it } from 'vitest';
2|import { setup } from './helpers';
3|
4|const createTenant = (send: ReturnType<typeof setup>['send'], body: unknown) =>
5|  send('/admin/tenants', { method: 'POST', body: JSON.stringify(body) });
6|
7|describe('admin API', () => {
8|  it('lists the seeded tenants', async () => {
9|    const { send } = setup();
10|    const body = (await (await send('/admin/tenants')).json()) as { tenants: Array<{ id: string }> };
11|    expect(body.tenants.map((t) => t.id)).toEqual(['tenant-a', 'tenant-b']);
12|  });
13|
14|  it('creates a tenant', async () => {
15|    const { send } = setup();
16|    const res = await createTenant(send, { id: 'tenant-c', name: 'Tenant C' });
17|    expect(res.status).toBe(201);
18|    expect(await res.json()).toMatchObject({ id: 'tenant-c', name: 'Tenant C' });
19|  });
20|
21|  it('refuses a duplicate tenant id', async () => {
22|    const { send } = setup();
23|    expect((await createTenant(send, { id: 'tenant-a', name: 'Again' })).status).toBe(409);
24|  });
25|
26|  it('refuses an invalid tenant id', async () => {
27|    const { send } = setup();
28|    expect((await createTenant(send, { id: 'Not Valid', name: 'x' })).status).toBe(400);
29|    expect((await createTenant(send, { name: 'no id' })).status).toBe(400);
30|  });
31|
32|  it('lets a new tenant receive webhooks', async () => {
33|    const { send, postWebhook } = setup();
34|    await createTenant(send, { id: 'tenant-c', name: 'Tenant C' });
35|    expect((await postWebhook('tenant-c', { type: 'hello' })).status).toBe(202);
36|  });
37|});

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
  "path": "src/lib/audit.ts"
}

Tool call: read_file {
  "path": "src/routes/webhooks.ts"
}

Tool call: read_file {
  "path": "test/helpers.ts"
}

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
  "path": "src/routes/audit.ts"
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

Tool call: edit_file {
  "path": "src/lib/tenants.ts"
}

Tool call: edit_file {
  "path": "src/routes/admin.ts"
}

Tool result (edit_file):
edited
changed lines: lines 29-31
--- original
+++ updated
@@
-  get(id: string): Tenant | undefined {
-    return this.tenants.get(id);
-  }
+  get(id: string): Tenant | undefined {
+    return this.tenants.get(id);
+  }
+
+  remove(id: string): boolean {
+    return this.tenants.delete(id);
+  }


Tool result (edit_file):
edited
changed lines: lines 25-26
--- original
+++ updated
@@
-  return r;
-}
+  r.delete('/tenants/:id', (c) => {
+    const id = c.req.param('id');
+    const tenant = deps.tenants.get(id);
+    if (!tenant) return c.json({ error: `unknown tenant ${id}` }, 404);
+    deps.tenants.remove(id);
+    deps.audit.record(id, 'tenant.deleted', id);
+    return c.json(tenant);
+  });
+
+  return r;
+}


Tool call: edit_file {
  "path": "test/admin.test.ts"
}

Tool result (edit_file):
edited
changed lines: lines 32-37
--- original
+++ updated
@@
-  it('lets a new tenant receive webhooks', async () => {
-    const { send, postWebhook } = setup();
-    await createTenant(send, { id: 'tenant-c', name: 'Tenant C' });
-    expect((await postWebhook('tenant-c', { type: 'hello' })).status).toBe(202);
-  });
-});
+  it('lets a new tenant receive webhooks', async () => {
+    const { send, postWebhook } = setup();
+    await createTenant(send, { id: 'tenant-c', name: 'Tenant C' });
+    expect((await postWebhook('tenant-c', { type: 'hello' })).status).toBe(202);
+  });
+
+  it('deletes a known tenant', async () => {
+    const { send } = setup();
+    const res = await send('/admin/tenants/tenant-a', { method: 'DELETE' });
+    expect(res.status).toBe(200);
+    expect(await res.json()).toMatchObject({ id: 'tenant-a' });
+    const body = (await (await send('/admin/tenants')).json()) as { tenants: Array<{ id: string }> };
+    expect(body.tenants.map((t) => t.id)).toEqual(['tenant-b']);
+  });
+
+  it('answers 404 when deleting an unknown tenant', async () => {
+    const { send } = setup();
+    const res = await send('/admin/tenants/no-such-tenant', { method: 'DELETE' });
+    expect(res.status).toBe(404);
+    expect(await res.json()).toEqual({ error: 'unknown tenant no-such-tenant' });
+  });
+
+  it('writes an audit entry for the deletion', async () => {
+    const { send, deps } = setup();
+    await send('/admin/tenants/tenant-a', { method: 'DELETE' });
+    expect(deps.audit.list('tenant-a')).toContainEqual(
+      expect.objectContaining({ tenant: 'tenant-a', action: 'tenant.deleted', target: 'tenant-a' }),
+    );
+  });
+
+  it('rejects webhooks for a deleted tenant', async () => {
+    const { send, postWebhook } = setup();
+    await send('/admin/tenants/tenant-a', { method: 'DELETE' });
+    const res = await postWebhook('tenant-a', { type: 'hello' });
+    expect(res.status).toBe(404);
+  });
+});


Tool call: bash {
  "command": "bun run test 2>&1 | tail -20 && bun run typecheck 2>&1 | tail -5"
}

Tool result (bash):
{
  "chunk_id": "exec-1-1",
  "command": "bun run test 2>&1 | tail -20 && bun run typecheck 2>&1 | tail -5",
  "description": "Run test suite and typecheck",
  "exit_code": 0,
  "terminal_status": "completed",
  "output": "$ vitest run\n\n RUN  v3.2.7 <fixture>/.stint/worktrees/T-0001-r1\n\n ✓ test/backoff.test.ts (2 tests) 2ms\n ✓ test/config.test.ts (4 tests) 2ms\n ✓ test/webhooks.test.ts (7 tests) 10ms\n ✓ test/events.test.ts (5 tests) 11ms\n ✓ test/audit.test.ts (4 tests) 11ms\n ✓ test/admin.test.ts (9 tests) 13ms\n\n Test Files  6 passed (6)\n      Tests  31 passed (31)\n   Start at  12:51:46\n   Duration  495ms (transform 1.13s, setup 0ms, collect 1.40s, tests 49ms, environment 1ms, prepare 314ms)\n\n$ tsc --noEmit\n",
  "original_output_bytes": 569,
  "original_output_tokens": 143,
  "truncated": false
}

Assistant: Done. DELETE /admin/tenants/:id is implemented and the suite is green locally (31 tests, typecheck clean — the daemon's run is the record).

Changes:
- [tenants.ts](<fixture>/.stint/worktrees/T-0001-r1/src/lib/tenants.ts) — added `TenantRegistry.remove(id)` returning whether a tenant was deleted.
- [admin.ts](<fixture>/.stint/worktrees/T-0001-r1/src/routes/admin.ts) — added `DELETE /tenants/:id`: 404 `{ error: "unknown tenant <id>" }` for unknown tenants (same wording as POST /webhooks), otherwise removes the tenant, records `tenant.deleted` in the audit log with the tenant and target, and returns the deleted tenant as JSON. POST /webhooks needs no change since it already 404s on `tenants.get()` misses.
- [admin.test.ts](<fixture>/.stint/worktrees/T-0001-r1/test/admin.test.ts) — 4 new cases: delete known tenant, 404 for unknown, audit entry, webhooks 404 after deletion.

decision: DELETE returns 200 with the deleted tenant JSON, mirroring the create route's JSON response style, since the repo has no delete precedent.
decision: tests: test/admin.test.ts changed because the task explicitly requires adding tests for the delete path in that file.

Did not finish / did not look at: nothing outstanding for this task; I did not review backoff, config, or CSV export internals beyond confirming the suite passes.

## Changes on the task branch so far
- src/lib/tenants.ts +4 -0
- src/routes/admin.ts +9 -0
- test/admin.test.ts +31 -0

## Ask
Continue from the transcript: finish what it started.
