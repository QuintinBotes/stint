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

## Diff of the previous run
```diff
diff --git a/src/routes/audit.ts b/src/routes/audit.ts
index 752c669..834c62d 100644
--- a/src/routes/audit.ts
+++ b/src/routes/audit.ts
@@ -6,6 +6,9 @@ export function auditRoutes(deps: Deps): Hono {
 
   r.get('/', (c) => {
     const tenant = c.req.header('X-Tenant') || undefined;
+    if (c.req.query('format') === 'json') {
+      return c.json(deps.audit.list(tenant));
+    }
     c.header('Content-Type', 'text/csv; charset=utf-8');
     return c.body(deps.audit.toCsv(tenant));
   });
diff --git a/test/audit.test.ts b/test/audit.test.ts
index f6d795c..421aad4 100644
--- a/test/audit.test.ts
+++ b/test/audit.test.ts
@@ -32,4 +32,34 @@ describe('GET /audit', () => {
     expect(lines.slice(1).every((l) => l.includes(',tenant-a,'))).toBe(true);
     expect(lines).toHaveLength(2);
   });
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
 });
```

## Changes on the task branch so far
- src/routes/audit.ts +3 -0
- test/audit.test.ts +30 -0

## Ask
Continue from the diff: finish the task the previous run started.
