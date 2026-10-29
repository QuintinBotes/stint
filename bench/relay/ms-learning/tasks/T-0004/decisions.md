# Decisions for T-0004

## D1 · 2026-10-29T15:53:05.402Z · muse-code r1
compare returns normalized -1/0/1 rather than the millisecond difference, matching the classic sort-comparator contract and keeping it distinct from the arithmetic helpers
evidence: T-0004/r1#01M645TT3RNPVBEFTXGJ9WDM4K

## D2 · 2026-10-29T15:53:05.403Z · muse-code r1
compare takes string | number instead of StringValue | number so the acceptance snippet ['1h', '5m', '30s'].sort(compare) typechecks, since string[] is not assignable to StringValue[]; the internal to
evidence: T-0004/r1#01M645TT3RNPVBEFTXGJ9WDM4K

