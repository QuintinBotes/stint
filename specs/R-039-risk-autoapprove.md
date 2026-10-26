# R-039 · Risk tiers and an auto-approve lane earned in shadow mode

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-030, R-038

## Goal
Review becomes the bottleneck at factory volume. Low-risk changes can be approved by policy, but only after the policy has proved itself in shadow mode, and only if a person turns it on.

## Requirements
1. MUST assess risk after verification and review: high when the change touches `config.risk.highPaths` (defaults: auth, security, payments, migrations, CI config, lockfiles), deletes tests, is over 400 changed lines, or the review lens security found anything; medium when it touches more than 5 files or a public API; low otherwise; record `risk.assessed { tier, reasons }` and set `task.risk`.
2. MUST run shadow mode always: for each task the person approves or rejects, record `autoapprove.shadow { tier, wouldApprove, humanDecision }`; the Factory shows the shadow record (agreements, disagreements, reverts after would-approve).
3. MUST auto-approve only when `config.risk.autoApprove.enabled` is true (default false), the tier is in `tiers`, verification and every lens are green, and the shadow record for that tier covers `shadowDays` with no disagreement and no `outcome.reverted`; emit `autoapprove.granted` and merge with `by: 'policy'`; the person can turn it off from the Factory.

## Acceptance
1. A low-risk task is assessed low and shadow-recorded; with the lane off nothing is merged: `packages/daemon/test/risk.test.ts`.
2. With the lane on but a shadow disagreement in the window, nothing is merged; with a clean window it merges by policy: same file.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
