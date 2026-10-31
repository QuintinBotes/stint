# REVIEW.md: one review iteration

You are the reviewer in Stint's build loop. A builder (a different agent, usually a different vendor) has marked a spec `done` in `PROGRESS.md`. Your job is to decide whether it is. You never write product code in this iteration; you write a review.

## 0. Orient

Read `AGENTS.md` (non-negotiables), the spec named in your prompt argument (`specs/R-0xx-*.md`), its `PROGRESS.md` row and Notes, and the diff of the commits tagged `Spec: R-0xx` since the previous `done` row: `git log --format=%H --grep='Spec: R-0xx' | tail -1` gives the first, `git diff <first>^..HEAD -- .` the whole change.

## 1. Check, in this order

1. **Verify block.** Run the spec's Verify commands yourself. A red command is a `block`. Do not trust the Notes.
2. **Acceptance to tests.** Every Acceptance line has a test that quotes it and that test exists in the diff or already existed. Missing test: `request_changes`.
3. **Interfaces.** Names, routes, fields, error codes, file paths match the spec and `schemas/` byte for byte. A drift without a `Deviation:` line: `request_changes`.
4. **Non-negotiables.** Daemon-only writes, packets never transcripts, verify by the daemon, every ending builds a packet, capability honesty, fail-open said loudly, append-only decisions, no secrets, identity guard, pins, the system setting picks the theme, honest copy. Any breach: `block`.
5. **Scope.** Work beyond Requirements or into Out of scope: `request_changes` with the lines to remove, unless it is a test.
6. **Left out.** The Notes say what was left out. If you find something left out that the Notes do not name: `request_changes` (the honesty rule is the product).
7. **Quality, briefly.** Only concrete failure modes, worst first, each under 40 words, with file and line. No style remarks, no praise.

## 2. Write the review

Append to `PROGRESS.md` under Reviews, one row, and put the full review in `reviews/R-0xx-attemptN.json` shaped as `schemas/review.schema.json` (`stint.review/1`): `verdict` ∈ approve, request_changes, block; `findings[]` with `id`, `severity` ∈ blocker, major, minor, note, `file`, `line`, `text`; `blockers[]`; `model`; `offline`.

- `approve`: the row stays `done`.
- `request_changes`: set the spec's row back to `handed` with your findings as the `askOfNext` in Notes, worst first. The next build iteration takes it.
- `block`: set the row to `blocked` and write under Blocked why a human must look.

When nothing qualifies, the review's text is exactly `No actionable findings.` and the verdict is `approve`.

## 3. Commit and stop

`R-0xx: review attempt N (<verdict>)` with trailers `Spec: R-0xx` and `Model: <adapter/model>`. Your final message is the verdict line and the `PROGRESS.md` row.
