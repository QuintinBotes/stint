# The first scorecard run (29 October): it measured a Stint agent defect

Nine attempts of the Stint agent on Muse Spark Open (Baseten), three per seeded task, $0.76 in all. Every attempt was graded red by the hidden tests, and Glimmer's offline review approved all nine.

The cause was in Stint, not in the model. Muse Spark Open reasons before it acts, and in each attempt it spent its 4,096 output tokens reasoning: the reply came back cut off (`finish_reason: length`) with no text and no tool call. The Stint agent read a reply with no tool call as the end of the run, so each run "completed" after reading files, without writing any. The diffs are empty; the repository's own tests stayed green because nothing changed, and the hidden tests failed for the same reason.

The fix (`packages/adapters/stint-agent`): a reply cut off before the model says or does anything is asked again with more room (4,096, then 16,384, then 32,768 tokens), and a model still cut off at the most room ends the run failed, saying why. The scorecard in `bench/scorecard.json` is the rerun after the fix. These files are kept as they were run.
