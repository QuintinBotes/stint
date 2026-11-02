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

## Diff of the previous run
```diff
diff --git a/src/config.ts b/src/config.ts
index 7816adc..6e6816a 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -3,6 +3,8 @@ export interface Config {
   maxBodyBytes: number;
   replayMaxAttempts: number;
   replayBaseDelayMs: number;
+  rateLimitMax: number;
+  rateLimitWindowMs: number;
 }
 
 type Env = Record<string, string | undefined>;
@@ -19,5 +21,7 @@ export function loadConfig(env: Env = process.env): Config {
     maxBodyBytes: positiveInt(env.MAX_BODY_BYTES, 65536),
     replayMaxAttempts: positiveInt(env.REPLAY_MAX_ATTEMPTS, 5),
     replayBaseDelayMs: positiveInt(env.REPLAY_BASE_DELAY_MS, 100),
+    rateLimitMax: positiveInt(env.RATE_LIMIT_MAX, 100),
+    rateLimitWindowMs: positiveInt(env.RATE_LIMIT_WINDOW_MS, 60000),
   };
 }
diff --git a/src/lib/limiter.ts b/src/lib/limiter.ts
new file mode 100644
index 0000000..c3d0332
--- /dev/null
+++ b/src/lib/limiter.ts
@@ -0,0 +1,22 @@
+export interface LimitResult {
+  allowed: boolean;
+  retryAfterSec: number;
+}
+
+export class RateLimiter {
+  private hits = new Map<string, { count: number; windowStart: number }>();
+
+  check(key: string, limit: number, windowMs: number, now = Date.now()): LimitResult {
+    let entry = this.hits.get(key);
+    if (!entry || now - entry.windowStart >= windowMs) {
+      entry = { count: 0, windowStart: now };
+      this.hits.set(key, entry);
+    }
+    if (entry.count >= limit) {
+      const retryAfterSec = Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000));
+      return { allowed: false, retryAfterSec };
+    }
+    entry.count += 1;
+    return { allowed: true, retryAfterSec: 0 };
+  }
+}
```

## Changes on the task branch so far
- src/config.ts +4 -0
- src/lib/limiter.ts +22 -0

## Ask
Continue from the diff: finish the task the previous run started.
