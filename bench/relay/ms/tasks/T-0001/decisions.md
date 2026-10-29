# Decisions for T-0001

## D1 · 2026-10-29T14:56:57.756Z · codex r3
`unit` option is typed as `UnitAnyCase` so it accepts any spelling and case the parser takes
evidence: T-0001/r3#01M642M1CR1PXWA8D46Y2QHMD2

## D2 · 2026-10-29T14:56:57.757Z · codex r3
format with `unit` rounds via `Math.round(value / divisor)` and reuses the existing `plural()` helper for long forms; `ms` long form stays `"N ms"`
evidence: T-0001/r3#01M642M1CR1PXWA8D46Y2QHMD2

## D3 · 2026-10-29T14:56:57.757Z · codex r3
parse with `unit` uses the option only for unitless strings; an explicit unit in the string wins; invalid strings still return NaN
evidence: T-0001/r3#01M642M1CR1PXWA8D46Y2QHMD2

## D4 · 2026-10-29T14:56:57.758Z · codex r3
unknown `unit` throws `Unknown unit "X" provided to ms.parse()/ms.format()` naming the passed value
evidence: T-0001/r3#01M642M1CR1PXWA8D46Y2QHMD2

## D5 · 2026-10-29T14:56:57.758Z · codex r3
`parseStrict` also forwards the `unit` option for parity with `parse`
evidence: T-0001/r3#01M642M1CR1PXWA8D46Y2QHMD2

