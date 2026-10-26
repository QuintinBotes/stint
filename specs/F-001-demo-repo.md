# F-001 · Demo repo fixture: a webhook service with 27 passing tests

Day: before kickoff (fixture, not product code) · Owner: CC · Depends on: none · Fallback: a smaller service with 15 tests · Cut: never

## Goal
A small, real TypeScript service that every demo task is run against: webhooks in, per-tenant handling, an audit log, an admin API. It must have enough surface for T-0040 (done in the past, seeded), T-0042 (rate-limit incoming webhooks, the live task) and T-0043 (rate-limit the admin API, the "it learned" task) to be natural one-hour tasks for a coding agent, and a test suite the daemon can parse.

## Context
Lives in `demo/repo/` with its own git history (a fixture tarball `demo/repo.tar.gz` plus a script that unpacks it to a temp dir is acceptable if a nested repo is awkward). Vitest is used here on purpose: the daemon's verifier (R-005) parses both Vitest and `bun test` summaries.

## Requirements
1. MUST be a Bun + TypeScript HTTP service (Hono) with routes: `POST /webhooks` (tenant from `X-Tenant` header), `GET /events` (per tenant), `GET /admin/tenants`, `POST /admin/tenants`, `GET /audit` (CSV export), `POST /events/:id/replay`.
2. MUST have exactly 27 passing Vitest tests across at least 5 files, under 3 seconds total, no network.
3. MUST have no rate limiting anywhere (T-0042 and T-0043 add it) and a config module that reads env with defaults (so "configurable through env" is a natural change).
4. MUST have a git history of at least 12 commits with sensible messages, including one commit whose message carries `Stint-Task: T-0040` and the trailer set from R-017 (the seeded past task "Add tenant header to audit log"), so the memory graph has history on day 1.
5. MUST include `AGENTS.md` with the service's own conventions (so Muse Code and Claude Code read something real) and `.agents/skills/review-voice-policy/SKILL.md` copied from review-voice unchanged.
6. SHOULD have one deliberately recurring weakness that a reviewer will flag on T-0040's seeded review and again on T-0042 (limits hard-coded, no jitter on backoff), so the learn step's recurrence check fires.
7. MUST be free of real names, emails and client material; `scripts/guard-identity.mjs` passes on it.

## Interfaces
- `demo/repo/package.json` scripts: `test` → `vitest run`, `dev`, `typecheck`.
- `demo/repo/src/{app.ts, config.ts, routes/{webhooks,events,admin,audit}.ts, lib/{audit,tenants,store}.ts}`; tests in `demo/repo/test/*.test.ts`.
- Seeded `.stint/` is **not** part of this fixture (R-022 seeds it); the fixture only carries the git history and the T-0040 commit.

## Acceptance
1. `cd demo/repo && bun install && bun run test` prints `Tests  27 passed (27)`: `demo/repo/test/*.test.ts`.
2. `git -C demo/repo log --format=%B | grep -c 'Stint-Task: T-0040'` is 1.
3. `node scripts/guard-identity.mjs demo/repo` exits 0.
4. A fresh clone runs the suite in under 10 seconds including install.

## Verify
```
cd demo/repo && bun install --frozen-lockfile && bun run typecheck && bun run test
git -C demo/repo log --format=%B | grep -q 'Stint-Task: T-0040'
node scripts/guard-identity.mjs demo/repo
```

## Out of scope
Rate limiting, Redis, auth, deployment, any Stint code.

## Notes
Keep the service boring and readable; the agents on camera must be able to find the webhook route in ten seconds. Name the tenant header `X-Tenant`. The T-0040 commit should touch `src/lib/audit.ts` and `src/routes/audit.ts` so `files-together` has a real answer.
