# Decisions for T-0002

## D1 · 2026-10-29T15:46:10.487Z · muse-code r1
add() follows toSeconds() conventions - each argument is a StringValue or finite number of milliseconds, strings go through parse() (NaN propagates), non-finite numbers and non-string/non-number types
evidence: T-0002/r1#01M645E4XPFSMB9S5S7XCY27GM

