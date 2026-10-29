# Decisions for T-0001

## D1 · 2026-10-29T15:22:53.680Z · codex r3
`unit` option type is `UnitAnyCase` so it accepts every spelling and case the parser accepts.
evidence: T-0001/r3#01M6443GVDD300K3FRHG999RTX

## D2 · 2026-10-29T15:22:53.681Z · codex r3
`format` with `unit` rounds with `Math.round(value / factor)`, matching existing format rounding.
evidence: T-0001/r3#01M6443GVDD300K3FRHG999RTX

## D3 · 2026-10-29T15:22:53.681Z · codex r3
`format` long for `ms` stays `"N ms"`, matching existing `fmtLong`.
evidence: T-0001/r3#01M6443GVDD300K3FRHG999RTX

## D4 · 2026-10-29T15:22:53.681Z · codex r3
`parse` with `unit` uses it only as default; a unit in the string wins and an unused unknown option is ignored.
evidence: T-0001/r3#01M6443GVDD300K3FRHG999RTX

## D5 · 2026-10-29T15:22:53.681Z · codex r3
`parseStrict` also accepts `{ unit }` and forwards to `parse`.
evidence: T-0001/r3#01M6443GVDD300K3FRHG999RTX

## D6 · 2026-10-29T15:22:53.682Z · codex r3
unknown `unit` throws `Error` naming the raw unit with `ms.parse()` / `ms.format()` context.
evidence: T-0001/r3#01M6443GVDD300K3FRHG999RTX

