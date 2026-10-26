# R-038 · Review lenses and best-of-n reviews

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-010, R-035

## Goal
Several reviewers with different jobs find more than one generalist.

## Requirements
1. MUST run one review per lens in `config.review.lenses` (`general`, `security`, `spec-fit`), each with its own prompt (security: injection, secrets, auth, unsafe input; spec-fit: each acceptance criterion met or not), recorded as `review.recorded` with `lens`.
2. MUST, with `review.bestOf` = n > 1, ask n reviewers from different hosts for the general lens, merge their findings (same file and line or same theme = one finding, counting agreement) and flag disagreements on the verdict.
3. MUST combine lenses into one verdict for the gate (any block blocks; any request_changes asks) and show each lens on the review tab.

## Acceptance
1. Three lenses produce three reviews and one combined verdict; a security block blocks the gate: `packages/daemon/test/review.lenses.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
