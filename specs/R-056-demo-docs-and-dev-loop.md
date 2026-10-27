# R-056 · The demo runner, the docs and the dev loop, as specified

Day: added 27 Oct from the requirements audit · Owner: Q (docs) and MC (CLI) · Depends on: R-001, R-007, R-022, R-023 · Fallback: requirements 5 to 8 · Cut order: 7

## Goal
Finish what R-001, R-007, R-022 and R-023 asked of the dev loop, the palette, the live demo runner and the docs, and cover the empty states and the timeline in the UI tests.

## Context
Root scripts are in `package.json`; the palette is `taskActions` in `apps/web/src/components/Shell.tsx`; the live demo is `packages/cli/src/demo.ts` with `packages/cli/src/demo/live.ts` and `demo/preflight.ts`; the docs are `README.md` and `docs/*.md`, checked by `packages/core/test/docs.claims.test.ts`.

## Requirements
1. MUST make `bun run dev` run the daemon with `bun --watch` beside `vite`, keeping `bun run demo` for the replay.
2. MUST open `CHANGELOG.md` with an `## Unreleased` section in Keep a Changelog groups (Added, Changed, Fixed) above `0.1.0`.
3. MUST add an Assign action to the palette (`stint assign <task> <agent>`), and show the CLI command for "Open the terminal" and "Show the diff" beside their keys.
4. MUST add `--from <beat>`, `--take <n>`, `--mic` (record the voice beat from the microphone) and `--offline-plan` (plan on the local model) to `stint demo --live`, and name the optional `FIREWORKS_API_KEY` and `BASETEN_API_KEY` in preflight with what each enables.
5. MUST add to the README a "What is real" section that says which numbers come from live runs (the bench, the golden set, the skill eval, the quiz) and which from the hand-written replay, and put the live packet inline.
6. MUST put a live packet in `docs/packet.md` and measured rehearsal timings in `docs/demo.md`.
7. MUST check the README's bench table against `bench/results.json` and `bench/digest/results.json`, and the golden line against `bench/golden-results.json`, in the claims test.
8. MUST document `bun x @stint-dev/cli demo` in the quick start beside `bun run dev`.
9. MUST cover in UI tests: the Files tab and the timeline empty states; r4 and each segment's vendor colour on the T-0042 rail; the terminal filling its pane with the kill button visible.

## Acceptance
1. `bun run dev` starts the daemon and vite, and a change to a daemon file restarts it: `scripts/test/dev.test.ts`.
2. The palette lists Assign with its CLI command: `apps/web/e2e/actions.spec.ts`.
3. `stint demo --live --from review --take 2` starts at the review beat and writes take 2: `packages/cli/test/demo.live.test.ts`.
4. The claims test fails when a README bench or golden number differs from the results files: `packages/core/test/docs.claims.test.ts`.
5. The empty states, the rail colours and the terminal fit: `apps/web/e2e/empty.spec.ts`, `apps/web/e2e/timeline.spec.ts`, `apps/web/e2e/terminal.spec.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh && bun run test:ui
```

## Out of scope
Recording the video; publishing the package (the owner's steps, R-057).

## Notes
`--mic` needs the browser or a local recorder; when neither is available it says so and uses the typed task.
