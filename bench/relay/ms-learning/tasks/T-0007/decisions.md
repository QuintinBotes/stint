# Decisions for T-0007

## D1 · 2026-10-29T16:00:12.423Z · muse-code r1
average() throws on empty or non-array input rather than returning NaN, since a mean over zero values is undefined and sibling helpers throw on invalid input.
evidence: T-0007/r1#01M6467V45SP167BJW4RG42GXD

