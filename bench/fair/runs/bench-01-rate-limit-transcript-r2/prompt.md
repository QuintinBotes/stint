# Stint task T-0001: Rate-limit incoming webhooks per tenant

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
POST /webhooks answers 429 with a Retry-After header when one tenant sends more webhooks than the configured limit in the configured window. Put the limiter in src/lib/limiter.ts, wire it into src/routes/webhooks.ts (and src/app.ts if it needs shared state), and read the limit and the window through loadConfig() in src/config.ts with defaults. Add tests in test/webhooks.test.ts or a new test file.

Acceptance:
- A tenant over the limit gets 429 with a Retry-After header
- Other tenants are not affected
- The limit and the window come from config, not constants in a route
- The suite stays green with new tests for the 429 path

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Transcript of the previous run
User: # Stint task T-0001: Rate-limit incoming webhooks per tenant

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
POST /webhooks answers 429 with a Retry-After header when one tenant sends more webhooks than the configured limit in the configured window. Put the limiter in src/lib/limiter.ts, wire it into src/routes/webhooks.ts (and src/app.ts if it needs shared state), and read the limit and the window through loadConfig() in src/config.ts with defaults. Add tests in test/webhooks.test.ts or a new test file.

Acceptance:
- A tenant over the limit gets 429 with a Retry-After header
- Other tenants are not affected
- The limit and the window come from config, not constants in a route
- The suite stays green with new tests for the 429 path

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Changes on the task branch so far
None yet.

## Ask
Implement the goal. Follow the plan where there is one.

Tool call: read_file {
  "path": "src/app.ts"
}

Tool call: read_file {
  "path": "src/config.ts"
}

Tool call: read_file {
  "path": "src/routes/webhooks.ts"
}

Tool call: read_file {
  "path": "test/helpers.ts"
}

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
  "path": "test/webhooks.test.ts"
}

Tool call: read_file {
  "path": "src/lib/audit.ts"
}

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

Tool call: read_file {
  "path": "package.json"
}

Tool result (read_file):
Read text file `package.json`.
1|{
2|  "name": "webhook-service",
3|  "version": "0.1.0",
4|  "private": true,
5|  "type": "module",
6|  "scripts": {
7|    "dev": "bun --watch src/server.ts",
8|    "test": "vitest run",
9|    "typecheck": "tsc --noEmit"
10|  },
11|  "dependencies": {
12|    "hono": "4.13.14"
13|  },
14|  "devDependencies": {
15|    "@types/bun": "1.4.4",
16|    "typescript": "5.9.3",
17|    "vitest": "3.2.7"
18|  }
19|}

Tool call: write_file {
  "path": "src/lib/limiter.ts"
}

Tool result (write_file):
wrote 832 bytes to <fixture>/.stint/worktrees/T-0001-r1/src/lib/limiter.ts

Tool call: edit_file {
  "path": "src/config.ts"
}

Tool result (edit_file):
edited
changed lines: lines 1-6
--- original
+++ updated
@@
-export interface Config {
-  port: number;
-  maxBodyBytes: number;
-  replayMaxAttempts: number;
-  replayBaseDelayMs: number;
-}
+export interface Config {
+  port: number;
+  maxBodyBytes: number;
+  replayMaxAttempts: number;
+  replayBaseDelayMs: number;
+  rateLimitMaxRequests: number;
+  rateLimitWindowMs: number;
+}


Tool call: edit_file {
  "path": "src/config.ts"
}

Tool result (edit_file):
edited
changed lines: lines 22-23
--- original
+++ updated
@@
-    replayMaxAttempts: positiveInt(env.REPLAY_MAX_ATTEMPTS, 5),
-    replayBaseDelayMs: positiveInt(env.REPLAY_BASE_DELAY_MS, 100),
+    replayMaxAttempts: positiveInt(env.REPLAY_MAX_ATTEMPTS, 5),
+    replayBaseDelayMs: positiveInt(env.REPLAY_BASE_DELAY_MS, 100),
+    rateLimitMaxRequests: positiveInt(env.RATE_LIMIT_MAX_REQUESTS, 100),
+    rateLimitWindowMs: positiveInt(env.RATE_LIMIT_WINDOW_MS, 60000),


Tool call: edit_file {
  "path": "src/app.ts"
}

Tool result (edit_file):
edited
changed lines: lines 3-4
--- original
+++ updated
@@
-import { AuditLog } from './lib/audit';
-import { EventStore } from './lib/store';
+import { AuditLog } from './lib/audit';
+import { RateLimiter } from './lib/limiter';
+import { EventStore } from './lib/store';


Tool call: edit_file {
  "path": "src/app.ts"
}

Tool result (edit_file):
edited
changed lines: lines 12-22
--- original
+++ updated
@@
-export interface Deps {
-  config: Config;
-  store: EventStore;
-  tenants: TenantRegistry;
-  audit: AuditLog;
-}
-
-export function createDeps(config: Config = loadConfig()): Deps {
-  return {
-    config,
-    store: new EventStore(),
+export interface Deps {
+  config: Config;
+  store: EventStore;
+  tenants: TenantRegistry;
+  audit: AuditLog;
+  limiter: RateLimiter;
+}
+
+export function createDeps(config: Config = loadConfig()): Deps {
+  return {
+    config,
+    store: new EventStore(),
+    limiter: new RateLimiter(),

## Changes on the task branch so far
- src/app.ts +3 -0
- src/config.ts +4 -0
- src/lib/limiter.ts +23 -0

## Ask
Continue from the transcript: finish what it started.
