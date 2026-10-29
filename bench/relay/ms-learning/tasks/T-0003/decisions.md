# Decisions for T-0003

## D1 · 2026-10-29T15:49:02.227Z · muse-code r1
clamp reuses the shared toMilliseconds helper, parameterized with the caller name so its errors say clamp() while add()'s messages are unchanged
evidence: T-0003/r1#01M645KCMGQ39KN9S1NZQ06EHG

## D2 · 2026-10-29T15:49:02.229Z · muse-code r1
clamp is Math.min(Math.max(value, min), max) with no min<=max validation; inverted bounds yield max
evidence: T-0003/r1#01M645KCMGQ39KN9S1NZQ06EHG

