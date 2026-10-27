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
  "path": "src/app.ts"
}

Tool call: read_file {
  "path": "src/config.ts"
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
  "path": "src/lib/store.ts"
}

Tool call: read_file {
  "path": "src/routes/events.ts"
}

Tool call: read_file {
  "path": "package.json"
}

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

Tool call: bash {
  "command": "ls -la; git log --oneline -20 2>&1 | head -30; git status --short"
}

Tool result (bash):
{
  "chunk_id": "exec-1-1",
  "command": "ls -la; git log --oneline -20 2>&1 | head -30; git status --short",
  "description": "List files and git history",
  "exit_code": 0,
  "terminal_status": "completed",
  "output": "total 104\ndrwxr-xr-x@ 13 user  staff    416 Oct 27 12:55 .\ndrwxr-xr-x@  3 user  staff     96 Oct 27 12:55 ..\ndrwxr-xr-x@  3 user  staff     96 Oct 27 12:55 .agents\n-rw-r--r--@  1 user  staff    108 Oct 27 12:55 .git\n-rw-r--r--@  1 user  staff     18 Oct 27 12:55 .gitignore\n-rw-r--r--@  1 user  staff   1372 Oct 27 12:55 AGENTS.md\n-rw-r--r--@  1 user  staff    232 Oct 27 12:55 README.md\n-rw-r--r--@  1 user  staff  25512 Oct 27 12:55 bun.lock\ndrwxr-xr-x@ 50 user  staff   1600 Oct 27 12:55 node_modules\n-rw-r--r--@  1 user  staff    362 Oct 27 12:55 package.json\ndrwxr-xr-x@  7 user  staff    224 Oct 27 12:55 src\ndrwxr-xr-x@  9 user  staff    288 Oct 27 12:55 test\n-rw-r--r--@  1 user  staff    292 Oct 27 12:55 tsconfig.json\nbe1bee8 Ignore local env files\n5baa685 Add the review policy skill agents load\n8a210fc Add tenant header to audit log (T-0040)\n12e9e8b Document the service for coding agents\n4094a09 wip(T-0040 r2): tenant column and filter in the audit export\ne2edafd Test the backoff schedule and its cap\n566b384 Replay events with exponential backoff\n85fec40 Export the audit log as CSV\n68dd0ec Add admin routes to list and create tenants\nad35088 List stored events per tenant\n03b6045 Accept webhooks per tenant through the X-Tenant header\nf0d0ebe Add an audit log for state changes\na396cb8 Add the in-memory event store and tenant registry\nd4c36b1 Scaffold the service with config read from env\n",
  "original_output_bytes": 1513,
  "original_output_tokens": 379,
  "truncated": false
}

Tool call: read_file {
  "path": "README.md"
}

Tool call: bash {
  "command": "ls test/; cat test/*.test.ts | head -200"
}

Tool result (read_file):
Read text file `README.md`.
1|# Webhook service
2|
3|Receives webhooks per tenant, stores them in memory, replays them on request and keeps an audit log with a CSV export. See `AGENTS.md` for the layout and conventions.
4|
5|```
6|bun install
7|bun run test
8|bun run dev
9|```

Tool result (bash):
{
  "chunk_id": "exec-2-1",
  "command": "ls test/; cat test/*.test.ts | head -200",
  "description": "List test files",
  "exit_code": 0,
  "terminal_status": "completed",
  "output": "admin.test.ts\naudit.test.ts\nbackoff.test.ts\nconfig.test.ts\nevents.test.ts\nhelpers.ts\nwebhooks.test.ts\nimport { describe, expect, it } from 'vitest';\nimport { setup } from './helpers';\n\nconst createTenant = (send: ReturnType<typeof setup>['send'], body: unknown) =>\n  send('/admin/tenants', { method: 'POST', body: JSON.stringify(body) });\n\ndescribe('admin API', () => {\n  it('lists the seeded tenants', async () => {\n    const { send } = setup();\n    const body = (await (await send('/admin/tenants')).json()) as { tenants: Array<{ id: string }> };\n    expect(body.tenants.map((t) => t.id)).toEqual(['tenant-a', 'tenant-b']);\n  });\n\n  it('creates a tenant', async () => {\n    const { send } = setup();\n    const res = await createTenant(send, { id: 'tenant-c', name: 'Tenant C' });\n    expect(res.status).toBe(201);\n    expect(await res.json()).toMatchObject({ id: 'tenant-c', name: 'Tenant C' });\n  });\n\n  it('refuses a duplicate tenant id', async () => {\n    const { send } = setup();\n    expect((await createTenant(send, { id: 'tenant-a', name: 'Again' })).status).toBe(409);\n  });\n\n  it('refuses an invalid tenant id', async () => {\n    const { send } = setup();\n    expect((await createTenant(send, { id: 'Not Valid', name: 'x' })).status).toBe(400);\n    expect((await createTenant(send, { name: 'no id' })).status).toBe(400);\n  });\n\n  it('lets a new tenant receive webhooks', async () => {\n    const { send, postWebhook } = setup();\n    await createTenant(send, { id: 'tenant-c', name: 'Tenant C' });\n    expect((await postWebhook('tenant-c', { type: 'hello' })).status).toBe(202);\n  });\n});\nimport { describe, expect, it } from 'vitest';\nimport { setup } from './helpers';\n\ndescribe('GET /audit', () => {\n  it('exports CSV with a header row', async () => {\n    const { send } = setup();\n    const res = await send('/audit');\n    expect(res.headers.get('Content-Type')).toContain('text/csv');\n    expect((await res.text()).split('\\n')[0]).toBe('at,tenant,action,target');\n  });\n\n  it('writes one row per audit entry', async () => {\n    const { send, postWebhook } = setup();\n    await postWebhook('tenant-a', { type: 'one' });\n    await postWebhook('tenant-a', { type: 'two' });\n    const lines = (await (await send('/audit')).text()).trim().split('\\n');\n    expect(lines).toHaveLength(3);\n  });\n\n  it('carries the tenant on every row', async () => {\n    const { send, postWebhook } = setup();\n    await postWebhook('tenant-b', { type: 'one' });\n    const row = (await (await send('/audit')).text()).trim().split('\\n')[1] ?? '';\n    expect(row.split(',').slice(1)).toEqual(['tenant-b', 'webhook.received', 'evt_000001']);\n  });\n\n  it('filters the export by the X-Tenant header', async () => {\n    const { send, postWebhook } = setup();\n    await postWebhook('tenant-a', { type: 'one' });\n    await postWebhook('tenant-b', { type: 'two' });\n    const lines = (await (await send('/audit', { tenant: 'tenant-a' })).text()).trim().split('\\n');\n    expect(lines.slice(1).every((l) => l.includes(',tenant-a,'))).toBe(true);\n    expect(lines).toHaveLength(2);\n  });\n});\nimport { describe, expect, it } from 'vitest';\nimport { backoffMs } from '../src/lib/backoff';\n\ndescribe('backoff', () => {\n  it('doubles the delay on each attempt', () => {\n    expect([1, 2, 3, 4].map((n) => backoffMs(n, 100))).toEqual([100, 200, 400, 800]);\n  });\n\n  it('caps the delay at 30 seconds', () => {\n    expect(backoffMs(20, 100)).toBe(30_000);\n  });\n});\nimport { describe, expect, it } from 'vitest';\nimport { loadConfig } from '../src/config';\n\ndescribe('config', () => {\n  it('uses defaults when the environment is empty', () => {\n    expect(loadConfig({})).toEqual({ port: 3000, maxBodyBytes: 65536, replayMaxAttempts: 5, replayBaseDelayMs: 100 });\n  });\n\n  it('reads values from the environment', () => {\n    const confi
[tool result truncated at 4 KB]

Tool call: edit_file {
  "path": "src/lib/audit.ts"
}

Tool result (edit_file):
edited
changed lines: lines 27-31
--- original
+++ updated
@@
-  toCsv(tenant?: string): string {
-    const rows = this.list(tenant).slice(-EXPORT_LIMIT);
-    const lines = rows.map((e) => [e.at, e.tenant, e.action, e.target].map(csvCell).join(','));
-    return ['at,tenant,action,target', ...lines].join('\n') + '\n';
-  }
+  toCsv(tenant?: string): string {
+    const rows = this.list(tenant).slice(-EXPORT_LIMIT);
+    const lines = rows.map((e) => [e.at, e.tenant, e.action, e.target].map(csvCell).join(','));
+    return ['at,tenant,action,target', ...lines].join('\n') + '\n';
+  }
+
+  toJson(tenant?: string): AuditEntry[] {
+    return this.list(tenant).slice(-EXPORT_LIMIT);
+  }


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
+      return c.json(deps.audit.toJson(tenant));
+    }
+    c.header('Content-Type', 'text/csv; charset=utf-8');
+    return c.body(deps.audit.toCsv(tenant));
+  });

## Changes on the task branch so far
- src/lib/audit.ts +4 -0
- src/routes/audit.ts +3 -0

## Ask
Continue from the transcript: finish what it started.
