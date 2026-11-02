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

## Diff of the previous run
```diff
diff --git a/src/app.ts b/src/app.ts
index c41e355..b020cab 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -23,7 +23,7 @@ export function createDeps(config: Config = loadConfig()): Deps {
       { id: 'tenant-a', name: 'Tenant A' },
       { id: 'tenant-b', name: 'Tenant B' },
     ]),
-    audit: new AuditLog(),
+    audit: new AuditLog(config.auditExportLimit),
   };
 }
 
diff --git a/src/config.ts b/src/config.ts
index 7816adc..af15e8e 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -3,6 +3,7 @@ export interface Config {
   maxBodyBytes: number;
   replayMaxAttempts: number;
   replayBaseDelayMs: number;
+  auditExportLimit: number;
 }
 
 type Env = Record<string, string | undefined>;
@@ -19,5 +20,6 @@ export function loadConfig(env: Env = process.env): Config {
     maxBodyBytes: positiveInt(env.MAX_BODY_BYTES, 65536),
     replayMaxAttempts: positiveInt(env.REPLAY_MAX_ATTEMPTS, 5),
     replayBaseDelayMs: positiveInt(env.REPLAY_BASE_DELAY_MS, 100),
+    auditExportLimit: positiveInt(env.AUDIT_EXPORT_LIMIT, 5000),
   };
 }
diff --git a/src/lib/audit.ts b/src/lib/audit.ts
index 5bce0a3..d702839 100644
--- a/src/lib/audit.ts
+++ b/src/lib/audit.ts
@@ -5,8 +5,6 @@ export interface AuditEntry {
   target: string;
 }
 
-const EXPORT_LIMIT = 5000;
-
 function csvCell(value: string): string {
   return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
 }
@@ -14,6 +12,8 @@ function csvCell(value: string): string {
 export class AuditLog {
   private entries: AuditEntry[] = [];
 
+  constructor(private exportLimit: number) {}
+
   record(tenant: string, action: string, target: string, now = new Date()): AuditEntry {
     const entry = { at: now.toISOString(), tenant, action, target };
     this.entries.push(entry);
@@ -25,7 +25,7 @@ export class AuditLog {
   }
 
   toCsv(tenant?: string): string {
-    const rows = this.list(tenant).slice(-EXPORT_LIMIT);
+    const rows = this.list(tenant).slice(-this.exportLimit);
     const lines = rows.map((e) => [e.at, e.tenant, e.action, e.target].map(csvCell).join(','));
     return ['at,tenant,action,target', ...lines].join('\n') + '\n';
   }
diff --git a/test/audit.test.ts b/test/audit.test.ts
index f6d795c..1e262f6 100644
--- a/test/audit.test.ts
+++ b/test/audit.test.ts
@@ -32,4 +32,15 @@ describe('GET /audit', () => {
     expect(lines.slice(1).every((l) => l.includes(',tenant-a,'))).toBe(true);
     expect(lines).toHaveLength(2);
   });
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
 });
diff --git a/test/config.test.ts b/test/config.test.ts
index dbec790..5b3feff 100644
--- a/test/config.test.ts
+++ b/test/config.test.ts
@@ -3,12 +3,12 @@ import { loadConfig } from '../src/config';
 
 describe('config', () => {
   it('uses defaults when the environment is empty', () => {
-    expect(loadConfig({})).toEqual({ port: 3000, maxBodyBytes: 65536, replayMaxAttempts: 5, replayBaseDelayMs: 100 });
+    expect(loadConfig({})).toEqual({ port: 3000, maxBodyBytes: 65536, replayMaxAttempts: 5, replayBaseDelayMs: 100, auditExportLimit: 5000 });
   });
 
   it('reads values from the environment', () => {
-    const config = loadConfig({ PORT: '8080', MAX_BODY_BYTES: '1024', REPLAY_MAX_ATTEMPTS: '3', REPLAY_BASE_DELAY_MS: '50' });
-    expect(config).toEqual({ port: 8080, maxBodyBytes: 1024, replayMaxAttempts: 3, replayBaseDelayMs: 50 });
+    const config = loadConfig({ PORT: '8080', MAX_BODY_BYTES: '1024', REPLAY_MAX_ATTEMPTS: '3', REPLAY_BASE_DELAY_MS: '50', AUDIT_EXPORT_LIMIT: '100' });
+    expect(config).toEqual({ port: 8080, maxBodyBytes: 1024, replayMaxAttempts: 3, replayBaseDelayMs: 50, auditExportLimit: 100 });
   });
 
   it('falls back on values that are not numbers', () => {
@@ -20,4 +20,10 @@ describe('config', () => {
     const config = loadConfig({ PORT: '0', MAX_BODY_BYTES: '-1', REPLAY_MAX_ATTEMPTS: '2.5' });
     expect([config.port, config.maxBodyBytes, config.replayMaxAttempts]).toEqual([3000, 65536, 5]);
   });
+
+  it('reads the audit export limit with a default of 5000', () => {
+    expect(loadConfig({}).auditExportLimit).toBe(5000);
+    expect(loadConfig({ AUDIT_EXPORT_LIMIT: '10' }).auditExportLimit).toBe(10);
+    expect(loadConfig({ AUDIT_EXPORT_LIMIT: 'not a number' }).auditExportLimit).toBe(5000);
+  });
 });
```

## Changes on the task branch so far
- src/app.ts +1 -1
- src/config.ts +2 -0
- src/lib/audit.ts +3 -3
- test/audit.test.ts +11 -0
- test/config.test.ts +9 -3

## Ask
Continue from the diff: finish the task the previous run started.
