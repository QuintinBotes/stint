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

## Diff of the previous run
```diff
diff --git a/src/lib/tenants.ts b/src/lib/tenants.ts
index 3065154..22b2461 100644
--- a/src/lib/tenants.ts
+++ b/src/lib/tenants.ts
@@ -30,6 +30,10 @@ export class TenantRegistry {
     return this.tenants.get(id);
   }
 
+  remove(id: string): boolean {
+    return this.tenants.delete(id);
+  }
+
   create(id: string, name: string, now = new Date()): Tenant {
     if (!TENANT_ID.test(id)) throw new TenantError('id must be lowercase letters, digits and dashes', 'invalid');
     if (name.trim() === '') throw new TenantError('name is required', 'invalid');
```

## Changes on the task branch so far
- src/lib/tenants.ts +4 -0

## Ask
Continue from the diff: finish the task the previous run started.
