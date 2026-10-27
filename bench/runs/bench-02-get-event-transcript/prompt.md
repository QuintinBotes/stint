# Stint task T-0001: Get one stored event by id

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Add GET /events/:id in src/routes/events.ts: it returns the stored event as JSON when the X-Tenant header names the tenant that owns it, 400 when the header is missing, and 404 when the event does not exist or belongs to another tenant. Use the existing EventStore. Add tests in test/events.test.ts.

Acceptance:
- GET /events/:id returns the event for its owning tenant
- Another tenant asking for the same id gets 404
- A missing X-Tenant header gets 400
- The suite stays green with new tests for all three cases

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Transcript of the previous run
User: # Stint task T-0001: Get one stored event by id

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Add GET /events/:id in src/routes/events.ts: it returns the stored event as JSON when the X-Tenant header names the tenant that owns it, 400 when the header is missing, and 404 when the event does not exist or belongs to another tenant. Use the existing EventStore. Add tests in test/events.test.ts.

Acceptance:
- GET /events/:id returns the event for its owning tenant
- Another tenant asking for the same id gets 404
- A missing X-Tenant header gets 400
- The suite stays green with new tests for all three cases

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Changes on the task branch so far
None yet.

## Ask
Implement the goal. Follow the plan where there is one.

Tool call: read_file {
  "path": "src/routes/events.ts"
}

Tool call: read_file {
  "path": "src/lib/store.ts"
}

Tool call: read_file {
  "path": "src/app.ts"
}

Tool call: read_file {
  "path": "test/events.test.ts"
}

Tool call: read_file {
  "path": "test/helpers.ts"
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
Read text file `src/lib/store.ts`.
1|export type EventStatus = 'received' | 'replayed';
2|
3|export interface WebhookEvent {
4|  id: string;
5|  tenant: string;
6|  type: string;
7|  data: unknown;
8|  receivedAt: string;
9|  attempts: number;
10|  status: EventStatus;
11|}
12|
13|export class EventStore {
14|  private events = new Map<string, WebhookEvent>();
15|  private seq = 0;
16|
17|  add(tenant: string, type: string, data: unknown, now = new Date()): WebhookEvent {
18|    this.seq += 1;
19|    const event: WebhookEvent = {
20|      id: `evt_${String(this.seq).padStart(6, '0')}`,
21|      tenant,
22|      type,
23|      data,
24|      receivedAt: now.toISOString(),
25|      attempts: 0,
26|      status: 'received',
27|    };
28|    this.events.set(event.id, event);
29|    return event;
30|  }
31|
32|  get(id: string): WebhookEvent | undefined {
33|    return this.events.get(id);
34|  }
35|
36|  listByTenant(tenant: string): WebhookEvent[] {
37|    return [...this.events.values()].filter((e) => e.tenant === tenant);
38|  }
39|
40|  update(id: string, patch: Partial<Omit<WebhookEvent, 'id' | 'tenant'>>): WebhookEvent {
41|    const current = this.events.get(id);
42|    if (!current) throw new Error(`no event ${id}`);
43|    const next = { ...current, ...patch };
44|    this.events.set(id, next);
45|    return next;
46|  }
47|}

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
  "path": "src/routes/webhooks.ts"
}

Tool call: read_file {
  "path": "src/routes/admin.ts"
}

Tool call: read_file {
  "path": "src/routes/audit.ts"
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
  "path": "src/routes/events.ts"
}

Tool result (edit_file):
edited
changed lines: line 14
--- original
+++ updated
@@
-  r.post('/:id/replay', (c) => {
+  r.get('/:id', (c) => {
+    const tenant = c.req.header('X-Tenant');
+    if (!tenant) return c.json({ error: 'missing X-Tenant header' }, 400);
+    const event = deps.store.get(c.req.param('id'));
+    if (!event || event.tenant !== tenant) return c.json({ error: 'event not found' }, 404);
+    return c.json(event);
+  });
+
+  r.post('/:id/replay', (c) => {


Tool call: edit_file {
  "path": "test/events.test.ts"
}

Tool result (edit_file):
edited
changed lines: lines 35-43
--- original
+++ updated
@@
-  it('stops replaying after the configured number of attempts', async () => {
-    const { postWebhook, send } = setup({ replayMaxAttempts: 2 });
-    await postWebhook('tenant-a', { type: 'a.one' });
-    const replay = () => send('/events/evt_000001/replay', { method: 'POST', tenant: 'tenant-a' });
-    await replay();
-    await replay();
-    expect((await replay()).status).toBe(409);
-  });
-});
+  it('stops replaying after the configured number of attempts', async () => {
+    const { postWebhook, send } = setup({ replayMaxAttempts: 2 });
+    await postWebhook('tenant-a', { type: 'a.one' });
+    const replay = () => send('/events/evt_000001/replay', { method: 'POST', tenant: 'tenant-a' });
+    await replay();
+    await replay();
+    expect((await replay()).status).toBe(409);
+  });
+
+  it('returns one stored event for its owning tenant', async () => {
+    const { postWebhook, send } = setup();
+    await postWebhook('tenant-a', { type: 'a.one', data: { n: 1 } });
+    const res = await send('/events/evt_000001', { tenant: 'tenant-a' });
+    expect(res.status).toBe(200);
+    expect(await res.json()).toMatchObject({ id: 'evt_000001', tenant: 'tenant-a', type: 'a.one' });
+  });
+
+  it('returns 404 when another tenant asks for the same id', async () => {
+    const { postWebhook, send } = setup();
+    await postWebhook('tenant-a', { type: 'a.one' });
+    const res = await send('/events/evt_000001', { tenant: 'tenant-b' });
+    expect(res.status).toBe(404);
+  });
+
+  it('returns 404 for an unknown event id', async () => {
+    const { send } = setup();
+    const res = await send('/events/evt_999999', { tenant: 'tenant-a' });
+    expect(res.status).toBe(404);
+  });
+
+  it('requires the X-Tenant header to get one event', async () => {
+    const { postWebhook, send } = setup();
+    await postWebhook('tenant-a', { type: 'a.one' });
+    expect((await send('/events/evt_000001')).status).toBe(400);
+  });
+});


Tool call: bash {
  "command": "bun run typecheck 2>&1 | tail -20"
}

Tool result (bash):
{
  "chunk_id": "exec-1-1",
  "command": "bun run typecheck 2>&1 | tail -20",
  "description": "Run typecheck for verification",
  "exit_code": 0,
  "terminal_status": "completed",
  "output": "$ tsc --noEmit\n",
  "original_output_bytes": 15,
  "original_output_tokens": 4,
  "truncated": false
}

Tool call: bash {
  "command": "bun run test 2>&1 | tail -30"
}

Tool result (bash):
{
  "chunk_id": "exec-2-1",
  "command": "bun run test 2>&1 | tail -30",
  "description": "Run test suite for verification",
  "exit_code": 0,
  "terminal_status": "completed",
  "output": "$ vitest run\n\n RUN  v3.2.7 <fixture>/.stint/worktrees/T-0001-r1\n\n ✓ test/config.test.ts (4 tests) 2ms\n ✓ test/backoff.test.ts (2 tests) 2ms\n ✓ test/webhooks.test.ts (7 tests) 10ms\n ✓ test/admin.test.ts (5 tests) 11ms\n ✓ test/audit.test.ts (4 tests) 10ms\n ✓ test/events.test.ts (9 tests) 13ms\n\n Test Files  6 passed (6)\n      Tests  31 passed (31)\n   Start at  12:49:51\n   Duration  494ms (transform 1.21s, setup 0ms, collect 1.48s, tests 49ms, environment 1ms, prepare 325ms)\n\n",
  "original_output_bytes": 554,
  "original_output_tokens": 139,
  "truncated": false
}

## Changes on the task branch so far
- src/routes/events.ts +8 -0
- test/events.test.ts +27 -0

## Ask
Continue from the transcript: finish what it started.
