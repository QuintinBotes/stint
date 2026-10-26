# Stint task T-0001: Rate-limit incoming webhooks per tenant

You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.

Rules for this run:
- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.
- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>
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
User: Rate-limit incoming webhooks per tenant: POST /webhooks answers 429 with a Retry-After header when one tenant sends more webhooks than the configured limit in the configured window. Put the limiter in src/lib/limiter.ts, wire it into src/routes/webhooks.ts (and src/app.ts if it needs shared state), and read the limit and the window through loadConfig() in src/config.ts with defaults. Add tests in test/webhooks.test.ts or a new test file.

Tool call: read_file {
  "path": "test/helpers.ts"
}

Tool call: read_file {
  "path": "src/app.ts"
}

Tool call: read_file {
  "path": "package.json"
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

## Changes on the task branch so far
- src/lib/limiter.ts +1 -0

## Ask
Continue from the transcript: finish what it started.
