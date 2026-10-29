# R-068 · Seeing it work: a visual gate judged by Muse Spark, marked by SAM 3.1

Day: 6 (30 Oct) · Owner: CC · Depends on: R-029 (verify suite), R-063 (how it went), R-064 (proofs) · Fallback: screenshot judged by Muse Spark, no SAM mark · Cut order: 3

## Goal
Tests prove code paths; they miss a page that renders blank, a button off screen, a label that says the wrong thing. A person checks those by looking. Stint should look too, as part of verification, and show the person what it saw. A criterion whose proof is `visual` names a page and what should be seen there. After the tests pass, Stint starts the app from the run's worktree, opens the page in a headless browser, records it, and asks Muse Spark whether the criterion holds in what is on screen. When it does not, SAM 3.1 marks the element Muse Spark named, so the person and the next agent see exactly what looked wrong. This adds Meta's vision models to Stint: Muse Spark reads the screen and SAM 3.1 points at it.

## Context
- Proof kinds today: `test | scenario | check | human` (`packages/core/src/schemas/task.ts`). R-063's `outcome()` proves a criterion from its proof's result on the latest verification.
- The verifier runs the test command, the held-out scenarios and the tamper check in the run's worktree (`packages/daemon/src/verifier.ts`) and appends `verification.ran`.
- The Meta Model API key reaches `muse-spark-1.3` and `sam-3.1` (checked 29 Oct with a model list). Playwright is a dev dependency of `apps/web`.
- Every model call's cost is recorded (D-060); a verification's spend goes on the event it writes.

## Requirements
1. `visual` joins the proof kinds. Its `ref` is `<path> :: <what should be seen>`, for example `/admin :: a 429 banner saying try again in 60 s`.
2. Config `visual: { serve: string, url: string, readyTimeoutMs?: number }`: the command that starts the app in a worktree and the address it serves. With no `visual` config, a visual proof is "not checked" with that reason, and verification is otherwise unchanged.
3. After the tests are green, for each visual proof: start `serve` in the worktree (once per verification), wait for `url`, open the path at 1280x800 in headless Chromium, wait for the network to settle, take a screenshot, and record a short clip (at most 5 s). Stop the app afterwards, whatever happens.
4. Muse Spark judges the screenshot against the criterion with a structured output `{ holds: boolean, seen: string, problem?: string, element?: string }` (`element` names what is wrong in a few words). The image goes as an image input; the prompt carries the criterion and nothing from the page's text that could instruct the model.
5. When `holds` is false and `element` is set, SAM 3.1 segments that element on the screenshot from the text prompt; Stint draws the mask's outline and box on a copy of the screenshot.
6. `visual.checked` event per proof: `{ criterion, ref, holds, seen, problem?, element?, screenshot, marked?, clip?, cost }` with the images stored under the verification's artifacts. A visual proof that does not hold turns the verification red with the reason "<criterion>: <problem>".
7. The packet's "What failed" section carries each failed visual check's problem and the marked image path, so the next agent sees what looked broken.
8. UI: the Tests tab shows each visual check with its screenshot (the marked one when it failed), the verdict as a status label with its shape, and Muse Spark's `seen` sentence; How it went counts a visual proof like any other. The image has alt text from `seen`.
9. The Sharpen and spec builder proof proposals may propose `visual` for a criterion about what a person sees.
10. Replay: the demo can carry a recorded visual check (marked as recorded) so the judge page shows one.

## Acceptance
1. Core: `visual` proofs parse; `outcome()` proves a visual criterion from `visual.checked`.
2. Daemon tests with a fake serve command (a tiny static server), a fake Muse Spark and a fake SAM: holds gives green; a failure gives red with the problem, a marked image file exists, and the packet carries it; no `visual` config gives "not checked"; the app is stopped even when judging throws.
3. Browser test: the Tests tab shows a failed visual check with its marked screenshot and alt text.
4. One live run (approved spend) on the fixture app with a seeded visual defect: Muse Spark says it does not hold, SAM 3.1 marks the element, and the result is kept in `bench/visual/` with its cost.
5. `bash scripts/check.sh` and `bun run test:ui` pass.
