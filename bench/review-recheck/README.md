# Review recheck

This folder asks whether a hosted Meta reviewer catches the patches Muse Glimmer approved and the hidden tests then failed. It is for anyone checking the review figures in the scorecard.

## What was run

On 2 November 2026, `scripts/review-recheck.ts` reviewed every scorecard attempt the hidden tests graded again, with Muse Spark 1.3 on the Meta Model API (`meta-api/muse-spark-1.3`, the last entry of the reviewer chain). It gives the model what the daemon's reviewer gives it (`lensReview` and `modelRun` in `packages/daemon/src/routes/models.ts`):

- the prompt from `buildReviewPrompt` and `packages/adapters/openai-compatible/prompts/review.md`, with the diff capped at 3,000 tokens as the daemon caps it;
- the schema `packages/core/schemas/review.schema.json`, the reviewer's 120 second timeout and its 30,000 token budget;
- the packet the review read (the last `handoff.created` before the review started), the attempt's unified diff (`diff.patch`), the decisions valid when the review ran, and no reviewer skills, since the scorecard's clones have none.

The patches are all 18 graded attempts: the 9 in `bench/scorecard/` (3 passed the hidden tests, 6 failed) and the 9 in `bench/scorecard-1/` (all failed, all with empty diffs). That includes `ms-unit-option-a3`, which its own tests stopped, so no reviewer saw it on 29 October. A reviewer that flags everything would catch every failing patch and also block every passing one, so both are counted.

## Results

Flagged means any verdict other than approve (request changes or block), as the scorecard counts it.

| Reviewer | Failing patches flagged | Passing patches wrongly flagged | Cost |
|---|---|---|---|
| Muse Glimmer 30B on Ollama, recorded 29 October | 0 of 14 | 0 of 3 | $0.00 |
| Muse Spark 1.3 on the Meta Model API, 2 November | 5 of 15 | 0 of 3 | $0.1768 |
| Muse Glimmer 30B on Ollama, whole diff, 3 November | 1 of 15 | 0 of 3 | $0.00 |

Split by whether the failing patch changed any code:

| Failing patches | Glimmer flagged, recorded | Spark flagged | Glimmer flagged, whole diff |
|---|---|---|---|
| with a diff (ms a2 and a3, negotiator a1, wait-on a1) | 0 of 3 (a3 was not reviewed) | 2 of 4 | 1 of 4 |
| with an empty diff (wait-on a2 and a3, all 9 of the first scorecard) | 0 of 11 | 3 of 11 | 0 of 11 |

Spark's two catches on real diffs name the defect. On `ms-unit-option-a3` it blocked with "Long format with unit pluralizes from rounded value, so format(-1500,{unit:'s',long:true}) yields singular" at `src/index.ts:248`. On `negotiator-preferred-a1` it asked for changes: the `preferred` option was added for media types, languages and charsets but not encodings, and a scratch `check.js` was committed. Its three blocks on empty diffs say only that the diff is missing. Every verdict, summary and finding, with its token counts and cost, is in `verdicts.json`.

## Glimmer, run again with the whole diff

On 3 November the daemon's review cap changed: a reviewer on Ollama reads up to 12,000 tokens of diff, a hosted one 3,000, because a local review pays nothing per token (`packages/adapters/openai-compatible/src/prompts.ts`). `glimmer-local/` is Glimmer's pass on all 18 patches with that cap, so it saw every hunk: the six prompts the old cap had cut were 3,981 to 5,263 tokens by Stint's estimate, and Ollama reported up to 6,421 input tokens in its 32,768 token window. Every patch got a verdict, for $0.00.

Glimmer flagged one failing patch, `ms-unit-option-a3`, with the defect Spark found: at `src/index.ts:247` the plural is chosen from the rounded value, so `-1500` ms with unit `s` reads `-1 seconds`. It approved the other 14 failing patches, the other 3 with code among them, and none of the 3 passing patches was flagged.

The whole diff is not what changed the record. Every patch with a recorded Glimmer verdict got the same verdict again. On a3's capped prompt, `prompt.md`, Glimmer also asked for changes, once, with a finding that the diff did not show `parse` handling its new option, which is code the cap had left out; a second try timed out at 120 seconds. Each patch was reviewed once, and Glimmer's Ollama model file sets temperature 1, so a verdict can differ between runs.

## Glimmer on 2 November

Glimmer 30B is installed in the local Ollama (`muse-glimmer:30b-mlx`), and the first pass asked it too. During this run another local program kept a different model loaded in Ollama, and Glimmer timed out at its 120 second limit on the first two patches and did not answer a five-token request in four minutes. Waiting out a timeout on all 18 patches would have taken over two hours and given no verdicts, so the first pass was stopped after three patches, and the Glimmer column above is the recorded verdicts from `bench/scorecard.json` and `bench/scorecard-1/scorecard.json`.

The stopped pass is reported too (`stopped-pass.log`): its Spark verdicts on the first three patches were approve, approve and block with one finding, for $0.0501, the same verdicts the full pass gave. Both passes together cost $0.2269, all of it on the Meta Model API.

## What it shows

On the inputs Stint's reviewer gets, Muse Spark 1.3 flagged 2 of the 4 failing patches that changed code, with findings that name the bug, and flagged none of the 3 passing patches. Glimmer's recorded verdicts approved every one of them; given the whole diff on 3 November, it flagged 1 of the 4, `ms-unit-option-a3`.

## What it does not show

That Spark is a gate. It approved the other 2 failing patches with code and 8 of the 11 empty diffs, so 10 of the 15 failing patches still passed review. Each patch was reviewed once, and the false-alarm figure rests on 3 passing patches. The 3,000 token cap left 2 to 7 hunks out of 6 of the 7 non-empty diffs on 2 November, so Spark did not see the whole change; Glimmer did on 3 November and still approved 14 of the 15. The hidden tests remain the gate, and review is advice.

## Files

- `verdicts.json`: every patch, its hidden-test grade, the recorded Glimmer verdict and the Spark review in full, and the tables.
- `<source>-<attempt>/prompt.md`: the exact prompt each patch was reviewed with; `reviews.json` beside it is that patch's record.
- `stopped-pass.log`: the first pass, stopped after three patches.
- `glimmer-local/verdicts.json`: Glimmer's pass of 3 November with the whole diff; each patch's folder holds `prompt.md`, the capped prompt a hosted reviewer gets, `prompt-local.md`, the one Glimmer got, and `reviews.json`.

Run it again with `STINT_LIVE=1 bun --env-file=<your env file> scripts/review-recheck.ts --reviewers meta-api/muse-spark-1.3,ollama/muse-glimmer:30b-mlx --budget-usd 1.5`. Glimmer alone needs no key and costs nothing: `STINT_LIVE=1 bun scripts/review-recheck.ts --reviewers ollama/muse-glimmer:30b-mlx --out bench/review-recheck/glimmer-local`.
