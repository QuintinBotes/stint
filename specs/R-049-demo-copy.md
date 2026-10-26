# R-049 · The demo says what the factory does

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-029, R-031, R-032

## Goal
The beats stay; the words get sharper.

## Requirements
1. MUST show "N passed, tests unchanged" on the verification card when the lock holds.
2. MUST show "with skill: N findings, without: M" on the skill card from its eval.
3. MUST close the demo on "any harness, any model, one packet" over health chips listing every configured harness and host.
4. MUST update docs/video.md and docs/demo.md to these lines.

## Acceptance
1. The e2e replay shows "tests unchanged" on the T-0042 verification card and the eval line on the skill card: `apps/web/e2e/demo-copy.spec.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
