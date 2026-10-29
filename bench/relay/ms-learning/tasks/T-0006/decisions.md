# Decisions for T-0006

## D1 · 2026-10-29T15:57:38.617Z · muse-code r1
`between` follows the `clamp` pattern - `(StringValue | number)` args, conversion via the shared `toMilliseconds` helper, inclusive comparison `value >= min && value <= max`.
evidence: T-0006/r1#01M64634XQK3849BE2AZEK9YQJ

