# Stint task T-0001: Read the audit export limit from config

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Move the hard-coded audit export limit in src/lib/audit.ts into configuration: add auditExportLimit to loadConfig() in src/config.ts, read from the environment with the current value as the default, and pass it to AuditLog when createDeps builds it in src/app.ts. Add tests in test/config.test.ts and test/audit.test.ts.

Acceptance:
- The export limit comes from config with today's value as the default
- A small configured limit makes the CSV export keep only that many rows
- No limit constant is left in a route or in the audit library
- The suite stays green with new tests for the config value and the cap

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Transcript of the previous run
User: # Stint task T-0001: Read the audit export limit from config

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
- The test files this task and its plan name are locked. Changing one fails verification unless you record why on its own line as: decision: tests: <file> changed because <reason>. New tests, and new cases in other test files, are welcome.
- Say plainly what you did not finish and what you did not look at.
- After you stop, the daemon runs `bun run test` itself. A claim that the tests pass is not the record.

## Goal
Move the hard-coded audit export limit in src/lib/audit.ts into configuration: add auditExportLimit to loadConfig() in src/config.ts, read from the environment with the current value as the default, and pass it to AuditLog when createDeps builds it in src/app.ts. Add tests in test/config.test.ts and test/audit.test.ts.

Acceptance:
- The export limit comes from config with today's value as the default
- A small configured limit makes the CSV export keep only that many rows
- No limit constant is left in a route or in the audit library
- The suite stays green with new tests for the config value and the cap

## Skills mounted for this run
- review-voice-policy: How Review Voice policies are structured, layered, and approved. Use when writing or editing a .review-voice/policy.yaml, adding a repository-scoped rule, debugging why a finding was suppressed, or interpreting policy provenance.

## Plan
No plan was made for this task.

## Changes on the task branch so far
None yet.

## Ask
Implement the goal. Follow the plan where there is one.

Tool call: read_file {
  "path": "src/config.ts"
}

Tool call: read_file {
  "path": "src/lib/audit.ts"
}

Tool call: read_file {
  "path": "src/app.ts"
}

Tool call: read_file {
  "path": "test/config.test.ts"
}

Tool call: read_file {
  "path": "test/audit.test.ts"
}

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
Read text file `test/config.test.ts`.
1|import { describe, expect, it } from 'vitest';
2|import { loadConfig } from '../src/config';
3|
4|describe('config', () => {
5|  it('uses defaults when the environment is empty', () => {
6|    expect(loadConfig({})).toEqual({ port: 3000, maxBodyBytes: 65536, replayMaxAttempts: 5, replayBaseDelayMs: 100 });
7|  });
8|
9|  it('reads values from the environment', () => {
10|    const config = loadConfig({ PORT: '8080', MAX_BODY_BYTES: '1024', REPLAY_MAX_ATTEMPTS: '3', REPLAY_BASE_DELAY_MS: '50' });
11|    expect(config).toEqual({ port: 8080, maxBodyBytes: 1024, replayMaxAttempts: 3, replayBaseDelayMs: 50 });
12|  });
13|
14|  it('falls back on values that are not numbers', () => {
15|    expect(loadConfig({ PORT: 'eighty', MAX_BODY_BYTES: '' }).port).toBe(3000);
16|    expect(loadConfig({ MAX_BODY_BYTES: '' }).maxBodyBytes).toBe(65536);
17|  });
18|
19|  it('falls back on zero, negative and fractional values', () => {
20|    const config = loadConfig({ PORT: '0', MAX_BODY_BYTES: '-1', REPLAY_MAX_ATTEMPTS: '2.5' });
21|    expect([config.port, config.maxBodyBytes, config.replayMaxAttempts]).toEqual([3000, 65536, 5]);
22|  });
23|});

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
  "path": "src/routes/audit.ts"
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

Tool call: search

Tool result (search):


Tool call: search

Tool result (search):
src/app.ts:3:import { AuditLog } from './lib/audit';
src/app.ts:15:  audit: AuditLog;
src/app.ts:26:    audit: new AuditLog(),
src/lib/audit.ts:8:const EXPORT_LIMIT = 5000;
src/lib/audit.ts:14:export class AuditLog {
src/lib/audit.ts:28:    const rows = this.list(tenant).slice(-EXPORT_LIMIT);

Tool call: edit_file {
  "path": "src/config.ts"
}

Tool call: edit_file {
  "path": "src/config.ts"
}

Tool call: edit_file {
  "path": "src/lib/audit.ts"
}

Tool result (edit_file):
edited
changed lines: lines 4-6
--- original
+++ updated
@@
-  replayMaxAttempts: number;
-  replayBaseDelayMs: number;
-}
+  replayMaxAttempts: number;
+  replayBaseDelayMs: number;
+  auditExportLimit: number;
+}


Tool result (edit_file):
edited
changed lines: line 22
--- original
+++ updated
@@
-    replayBaseDelayMs: positiveInt(env.REPLAY_BASE_DELAY_MS, 100),
+    replayBaseDelayMs: positiveInt(env.REPLAY_BASE_DELAY_MS, 100),
+    auditExportLimit: positiveInt(env.AUDIT_EXPORT_LIMIT, 5000),


Tool result (edit_file):
edited
changed lines: lines 8-10
--- original
+++ updated
@@
-const EXPORT_LIMIT = 5000;
-
-function csvCell(value: string): string {
+function csvCell(value: string): string {


Tool call: edit_file {
  "path": "src/lib/audit.ts"
}

Tool call: edit_file {
  "path": "src/lib/audit.ts"
}

Tool call: edit_file {
  "path": "src/app.ts"
}

Tool result (edit_file):
edited
changed lines: lines 12-13
--- original
+++ updated
@@
-export class AuditLog {
-  private entries: AuditEntry[] = [];
+export class AuditLog {
+  private entries: AuditEntry[] = [];
+
+  constructor(private exportLimit: number) {}


Tool result (edit_file):
edited
changed lines: line 28
--- original
+++ updated
@@
-    const rows = this.list(tenant).slice(-EXPORT_LIMIT);
+    const rows = this.list(tenant).slice(-this.exportLimit);


Tool result (edit_file):
edited
changed lines: line 26
--- original
+++ updated
@@
-    audit: new AuditLog(),
+    audit: new AuditLog(config.auditExportLimit),


Tool call: edit_file {
  "path": "test/config.test.ts"
}

Tool call: edit_file {
  "path": "test/config.test.ts"
}

Tool result (edit_file):
edited
changed lines: line 6
--- original
+++ updated
@@
-    expect(loadConfig({})).toEqual({ port: 3000, maxBodyBytes: 65536, replayMaxAttempts: 5, replayBaseDelayMs: 100 });
+    expect(loadConfig({})).toEqual({ port: 3000, maxBodyBytes: 65536, replayMaxAttempts: 5, replayBaseDelayMs: 100, auditExportLimit: 5000 });


Tool result (edit_file):
edited
changed lines: lines 10-11
--- original
+++ updated
@@
-    const config = loadConfig({ PORT: '8080', MAX_BODY_BYTES: '1024', REPLAY_MAX_ATTEMPTS: '3', REPLAY_BASE_DELAY_MS: '50' });
-    expect(config).toEqual({ port: 8080, maxBodyBytes: 1024, replayMaxAttempts: 3, replayBaseDelayMs: 50 });
+    const config = loadConfig({ PORT: '8080', MAX_BODY_BYTES: '1024', REPLAY_MAX_ATTEMPTS: '3', REPLAY_BASE_DELAY_MS: '50', AUDIT_EXPORT_LIMIT: '100' });
+    expect(config).toEqual({ port: 8080, maxBodyBytes: 1024, replayMaxAttempts: 3, replayBaseDelayMs: 50, auditExportLimit: 100 });


Tool call: edit_file {
  "path": "test/config.test.ts"
}

Tool call: edit_file {
  "path": "test/audit.test.ts"
}

Tool result (edit_file):
edited
changed lines: lines 19-23
--- original
+++ updated
@@
-  it('falls back on zero, negative and fractional values', () => {
-    const config = loadConfig({ PORT: '0', MAX_BODY_BYTES: '-1', REPLAY_MAX_ATTEMPTS: '2.5' });
-    expect([config.port, config.maxBodyBytes, config.replayMaxAttempts]).toEqual([3000, 65536, 5]);
-  });
-});
+  it('falls back on zero, negative and fractional values', () => {
+    const config = loadConfig({ PORT: '0', MAX_BODY_BYTES: '-1', REPLAY_MAX_ATTEMPTS: '2.5' });
+    expect([config.port, config.maxBodyBytes, config.replayMaxAttempts]).toEqual([3000, 65536, 5]);
+  });
+
+  it('reads the audit export limit with a default of 5000', () => {
+    expect(loadConfig({}).auditExportLimit).toBe(5000);
+    expect(loadConfig({ AUDIT_EXPORT_LIMIT: '10' }).auditExportLimit).toBe(10);
+    expect(loadConfig({ AUDIT_EXPORT_LIMIT: 'not a number' }).auditExportLimit).toBe(5000);
+  });
+});


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
+  it('caps the CSV export at the configured limit, keeping the newest rows', async () => {
+    const { send, postWebhook } = setup({ auditExportLimit: 2 });
+    await postWebhook('tenant-a', { type: 'one' });
+    await postWebhook('tenant-a', { type: 'two' });
+    await postWebhook('tenant-a', { type: 'three' });
+    const lines = (await (await send('/audit')).text()).trim().split('\n');
+    expect(lines).toHaveLength(3);
+    expect(lines[1]).toContain('evt_000002');
+    expect(lines[2]).toContain('evt_000003');
+  });
+});

## Changes on the task branch so far
- src/app.ts +1 -1
- src/config.ts +2 -0
- src/lib/audit.ts +3 -3
- test/audit.test.ts +11 -0
- test/config.test.ts +9 -3

## Ask
Continue from the transcript: finish what it started.
