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

## Diff of the previous run
```diff
diff --git a/src/routes/events.ts b/src/routes/events.ts
index 2779eee..28c7ffc 100644
--- a/src/routes/events.ts
+++ b/src/routes/events.ts
@@ -11,6 +11,14 @@ export function eventRoutes(deps: Deps): Hono {
     return c.json({ events: deps.store.listByTenant(tenant) });
   });
 
+  r.get('/:id', (c) => {
+    const tenant = c.req.header('X-Tenant');
+    if (!tenant) return c.json({ error: 'missing X-Tenant header' }, 400);
+    const event = deps.store.get(c.req.param('id'));
+    if (!event || event.tenant !== tenant) return c.json({ error: 'event not found' }, 404);
+    return c.json(event);
+  });
+
   r.post('/:id/replay', (c) => {
     const tenant = c.req.header('X-Tenant');
     if (!tenant) return c.json({ error: 'missing X-Tenant header' }, 400);
diff --git a/test/events.test.ts b/test/events.test.ts
index 456701b..23ba2dd 100644
--- a/test/events.test.ts
+++ b/test/events.test.ts
@@ -32,6 +32,33 @@ describe('events', () => {
     expect(res.status).toBe(404);
   });
 
+  it('returns a single event for its owning tenant', async () => {
+    const { postWebhook, send } = setup();
+    const created = (await (await postWebhook('tenant-a', { type: 'a.one' })).json()) as { id: string };
+    const res = await send(`/events/${created.id}`, { tenant: 'tenant-a' });
+    expect(res.status).toBe(200);
+    expect(await res.json()).toMatchObject({ id: created.id, tenant: 'tenant-a', type: 'a.one' });
+  });
+
+  it('does not return another tenant\'s event', async () => {
+    const { postWebhook, send } = setup();
+    const created = (await (await postWebhook('tenant-a', { type: 'a.one' })).json()) as { id: string };
+    const res = await send(`/events/${created.id}`, { tenant: 'tenant-b' });
+    expect(res.status).toBe(404);
+  });
+
+  it('returns 404 for an event that does not exist', async () => {
+    const { send } = setup();
+    const res = await send('/events/evt_999999', { tenant: 'tenant-a' });
+    expect(res.status).toBe(404);
+  });
+
+  it('requires the X-Tenant header to get an event', async () => {
+    const { postWebhook, send } = setup();
+    await postWebhook('tenant-a', { type: 'a.one' });
+    expect((await send('/events/evt_000001')).status).toBe(400);
+  });
+
   it('stops replaying after the configured number of attempts', async () => {
     const { postWebhook, send } = setup({ replayMaxAttempts: 2 });
     await postWebhook('tenant-a', { type: 'a.one' });
```

## Changes on the task branch so far
- src/routes/events.ts +8 -0
- test/events.test.ts +27 -0

## Ask
Continue from the diff: finish the task the previous run started.
