# LOOP.md: one iteration of the build loop

You are one iteration of a spec-driven build loop for Stint. You have no memory of earlier iterations; everything you need is in files. Do exactly one spec, leave the repo green, record what you did, and stop. `scripts/loop.sh` will start the next iteration, possibly with a different agent or vendor.

## 0. Orient (read, do not skim)

1. `AGENTS.md` in full. Its non-negotiables bind you.
2. `GOAL.md`: the definition of done and the gates.
3. `PROGRESS.md`: the ledger. Note the Decisions and Deviations sections; they change how specs are read.
4. `specs/SPEC-000-conventions.md`: how a spec is structured and verified.
5. `git status` and `git log --oneline -15`. If the tree is dirty and `PROGRESS.md` shows a spec `in_progress` or `handed`, you are resuming: read that spec's Notes row and the diff before anything else.

## 1. Pick the spec

Take the **first** row in `PROGRESS.md` (top to bottom) whose status is `handed`, then `in_progress`, then `todo`, and whose every `Depends on` spec is `done`. Skip rows marked `cut` or `blocked`. If none qualifies:
- every spec before the next gate is `done` → write `GATE n: ready for review` under Gates in `PROGRESS.md`, commit, and stop;
- otherwise write what is blocking under Blocked, commit, and stop.

Set the row to `in_progress`, add 1 to Attempts, put your adapter and model in Owner, and commit `R-0xx: start attempt N`.

## 2. Build it, tests first

1. Read the spec end to end: Goal, Requirements, Interfaces, Acceptance, Verify, Out of scope, Notes.
2. For each Acceptance line, write or extend the test the spec names before writing the code. The test's name quotes the acceptance line.
3. Implement the Requirements and nothing beyond them. Out of scope means out of scope; a tempting improvement goes into `PROGRESS.md` under Ideas, not into the code.
4. Keep the interfaces exactly as the spec writes them (names, routes, fields, error codes). If the spec and `schemas/` disagree, `schemas/` wins and you write a `Deviation:` line.
5. Validate every JSON you produce against the schema in `schemas/` in a test.
6. Run the spec's **Verify** block. All of it must exit 0. Then `bun run typecheck` and the full `bun test`: both green. If the spec touches `apps/web`, also `bun run build:web`.

## 3. Record and commit (every time, green or not)

**Green:** set the row to `done`, write one line in Notes: what shipped, what was left out (always say, even "nothing"), and the verify command you ran. Commit:

```
R-0xx: <title in a few words>

<two or three lines on what changed and why>

Spec: R-0xx
Model: <adapter/model, e.g. muse-code/muse-spark-1.3>
```

**Not green, and you are out of steps, time or ideas:** do not mark done. Commit what exists as `R-0xx: wip attempt N` (tests may be red in this commit, but nothing else on `main` may break: use a branch `spec/R-0xx` if the daemon is not yet building Stint with Stint). Set the row to `handed` (or `blocked` if Attempts is 3) and write a handoff note in Notes, in packet shape and under 600 tokens:

```
done: …
open: …
leftOut: … (what you did not look at; required)
risks: …
decisions: … (anything you chose that the next agent must not re-litigate)
askOfNext: … (the first thing to do next, concrete)
```

The next iteration continues from this note and the worktree, never from your transcript.

## 4. Rules that end an iteration early

Stop and write under Blocked, with the question, when:
- a decision cannot be undone and could reasonably go either way (licence, public names, deleting history, hackathon rules);
- a non-negotiable in `AGENTS.md` would have to bend;
- a spec's Verify needs a key, a model or a device you do not have (say which; mark the row `handed`, not `blocked`, so a human or a better-equipped agent takes it);
- `git` or CI shows someone else changed the files you are editing.

## 5. Things you never do

- Mark a spec `done` without its Verify block green in this iteration.
- Edit `specs/`, `schemas/` (outside the spec that owns a schema), pins, the CI matrix, `demo/repo` history, or anything under `.stint/` by hand.
- Feed a transcript to another agent, or read `transcript.jsonl` to build a packet.
- Add a dependency without a `Decision:` line.
- Put a key, a real email address, an em dash, or a client or employer name anywhere.
- Work on two specs, or "fix" an unrelated failing test by deleting it.
- Say a capability exists that the tests do not prove.

## 6. Your final message

Print the `PROGRESS.md` row you changed, the commit hash, and the Verify commands you ran with their exit codes. Nothing else.
