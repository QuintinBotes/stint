# Decisions for T-0001

## D1 · 2026-10-29T18:03:02.833Z · stint-agent r1
format with unit uses Math.round(ms / unitMultiplier) and plural helper for long output; milliseconds long with unit returns `${rounded} ms` to match existing style
evidence: T-0001/r1#01M64D8RSDVA2YHDDYJBGSYJRR

## D2 · 2026-10-29T18:03:02.836Z · stint-agent r1
parse with unit defers to string unit when present; otherwise multiplies parsed number by unit multiplier from a shared unitMap
evidence: T-0001/r1#01M64D8RSDVA2YHDDYJBGSYJRR

