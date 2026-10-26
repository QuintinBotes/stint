# SPEC-000 · How specs are written, read and verified

Every spec in this folder has the same nine sections. An agent reads them in order and treats them as follows.

| Section | What it is | How the agent uses it |
|---|---|---|
| Header | id, title, day, owner (MC = Muse Code, Q = the author), depends on, fallback, cut order | Eligibility and ownership; a fallback is what to build if the main path fails twice |
| Goal | One paragraph: the outcome and the demo beat it serves | The reason; never implement something the Goal does not need |
| Context | What already exists, where it is, which docs apply | Read before writing |
| Requirements | Numbered MUST / SHOULD lines | The scope; MUST lines are all implemented, SHOULD lines are implemented unless a Deviation says why not |
| Interfaces | Types, routes, CLI, file paths, exactly | Copied byte for byte; `schemas/` wins on conflict |
| Acceptance | Numbered, testable lines; each names its test file | Each becomes a test that quotes the line |
| Verify | Shell commands; all exit 0 = pass | Run in this order; the spec is done only when every line passes in the same iteration |
| Out of scope | What not to build here | Tempting work goes to `PROGRESS.md` Ideas |
| Notes | Gotchas, pins, prior art to port | Read before the first line of code |

## Conventions that apply to every spec

- **Paths** are repo-relative. Tests live in `<package>/test/*.test.ts` and run with `bun test <package>`. Playwright UI tests live in `apps/web/e2e/` and run with `bun run test:ui`.
- **Fixtures.** The demo repository `demo/repo` (F-001) is the only fixture for daemon tests that need git; tests copy it to a temp dir (`packages/core/test/fixture.ts` exports `withFixtureRepo()`), never run against the checkout.
- **Live tests** that need a key or a model are guarded by `STINT_LIVE=1` and skip otherwise with a visible reason; every live test has a replay twin that runs in CI.
- **Schemas** in `schemas/` are the contract. R-002 regenerates `packages/core/schemas/handoff.schema.json` from zod and the test asserts it is equal to `schemas/handoff.schema.json`; the other schemas are validated the same way.
- **Error codes** are the six in AGENTS.md section 5 plus any a spec names; a new code is a Deviation.
- **Logging** is one JSON line per event to stderr in the daemon, and to `events.jsonl` for anything a user would want to see later. No `console.log` in packages.
- **Copy** follows the design system README: sentence case, plain words, honest states, no emoji.
- **Commits** per LOOP.md section 3. One spec per commit series.
- **Time** is ISO 8601 UTC in files, local in the UI.
- **Done** means: Verify green, `bun run typecheck` green, `bun test` green, `PROGRESS.md` row updated with what was left out.
