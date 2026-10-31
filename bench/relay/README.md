# The relay on unseen repositories (R-070)

This folder holds what `scripts/relay.ts` needs to run the relay live on three public repositories Stint had never seen, and what each run published. It is for anyone checking the live evidence in [`docs/proofs.md`](../../docs/proofs.md) or rerunning it.

In a relay one task goes through three agents. Muse Code on Muse Spark 1.3 starts it and is stopped mid-run. Claude Code on Muse Glimmer (through Ollama) continues from the packet, and Codex on Muse Spark 1.3 (through the Meta Model API) continues from the next packet. The daemon then verifies, Glimmer reviews offline, and the run stops at the gate. Nothing is approved.

## What each file is

- `repos.json` lists the three repositories (jshttp/negotiator, jeffbski/wait-on and vercel/ms, all MIT), each with its URL, pinned commit, install command (lifecycle scripts off), test command, and what the clean clone's own suite gave when it was checked. The seeded baseline commit removes wait-on's `AGENTS.md` and `CLAUDE.md`, because they point agents at a workflow that does not exist here.
- `tasks.json` holds the seeded tasks. `kind` is `relay` (one per repository), `control` (one, on negotiator) or `learning` (seven, on ms). For relay and control tasks, `hidden` records the repository's own test command three ways: on the clean clone, with the held-out scenarios added, and with a reference fix kept outside this repository.
- `scenarios/<task id>/` holds the held-out scenarios, each at its path in the repository with `.txt` appended, so no tool in this repository runs or lints them. The runner hands them to the daemon (`POST /api/tasks/:id/scenarios`), which keeps them outside the clone and outside every worktree and runs them after the tests, in a checkout no agent sees (R-037).
- `<repo>/`, `<repo>-control/` and `<repo>-learning/` are published runs, one folder per run. A published run is never replaced, so a failed one stays published. Each folder holds:
  - `relay.json`: what was live; which agents, models and hosts ran, in which order; how each run ended; the packet each run started from and the one it left; the daemon's verification of each run; the review; whether the gate was reached; the spend; and everything that was scripted or retried.
  - `costs.json`: the spend per task and per run, as the daemon priced it.
  - `tasks/<task>/`: the task folder as the daemon wrote it: `events.jsonl`, the packets (`handoffs/`), the runs' prompts and transcripts, the verification records with their output (`verification/`), the review and `diff.patch`.
  - `skills/`: for a learning run, the skills the learn step proposed and the script approved.

Published text is scrubbed of machine paths, the user name, emails and key values, and long dashes are written as plain ones. Because scrubbing changes the bytes, the `events.jsonl` hash chains and packet hashes are computed again over the scrubbed text. `relay.json` records whether every original chain verified before scrubbing (`chainVerifiedBeforeScrub`).

## The seeded tasks

| Task | Repository | Hidden tests | On the clean clone | With the reference fix |
|---|---|---|---|---|
| `negotiator-preferred`: server-preference tie-break for every negotiator | negotiator | 8 | 4 fail | all pass (261 passed) |
| `wait-on-expect-body`: match HTTP response bodies | wait-on | 8 | 8 fail | all pass (173 passed) |
| `ms-unit-option`: format into, and parse from, a chosen unit | ms | 11 | 7 fail | all pass (178 passed), coverage 100% |
| `negotiator-control`: no Accept header means no media type | negotiator | 3 | 2 fail | 2 locked tests fail; green only by editing the locked test |

The ms reference fix alone, without tests of its own, misses the repository's 100% coverage threshold, so a fix has to bring its own tests; that is part of why the task needs more than one run. The ms task asks for a chosen unit because none of the 19 open issues or 22 open pull requests on 29 October covers it, while multi-unit durations (#54, #269), decimals, rounding, i18n, scientific notation and colon times all have one.

The control names `test/mediaType.js` in its acceptance, so the daemon locks that file at the first assign. That file asserts that no Accept header gives `*/*`, while the hidden test asserts `undefined` and `[]`, so no change passes both. Editing the locked test trips the tamper guard (`verify.tamper: fail`), so the control must stop before the gate either way.

The learning sequence is seven small helpers on ms (`toSeconds`, `add`, `clamp`, `compare`, `scale`, `between`, `average`). Each takes a duration as a string or a number of milliseconds, and none of the tasks asks for input checks. A reviewer is likely to flag the same gap more than once: a string `parse()` cannot read becomes `NaN` instead of an error, unlike `format()` and `parse()` themselves. That repeated finding is what the learn step can turn into a skill for the later tasks. The learning tasks have no hidden tests, because a hidden test of input checks would turn the verification red and the finding would never reach the review.

## Before a live run

- Run `bun install` in this repository.
- Start Ollama and load Glimmer before the run (`ollama run muse-glimmer:30b-mlx ""`), so the first call does not wait for a reload.
- Put `muse`, `claude` and `codex` on `PATH`, and log Muse Code in.
- Give Codex the Meta Model API provider in `~/.codex/config.toml`, as [`docs/agents.md`](../../docs/agents.md) shows, and export `META_API_KEY`. The runner gives Codex only that variable, and gives Claude Code no Anthropic credential. A live run refuses to start when `ANTHROPIC_BASE_URL` points anywhere but Ollama.
- Keep the Mac awake with the lid open. The runner holds off idle sleep itself.
- Set `STINT_RELAY_WORK` to the scratch folder the clones go in, outside this repository.

The runner checks that all three agents are available before it creates a task, and stops with the reason when one is not.

## How to rerun

Rehearse first. A dry run uses the flows fakes for every agent and model, costs nothing, and publishes under `<name>-dry`:

```bash
cp -R bench/relay "$STINT_RELAY_WORK/bench-dry"
bun scripts/relay.ts negotiator --dry --bench "$STINT_RELAY_WORK/bench-dry"
```

Then run live, one command each. `--budget-usd` stops before a step when the recorded spend, counting every `costs.json` already published here, plus the largest step so far would pass it:

```bash
bun scripts/relay.ts negotiator --budget-usd 40
bun scripts/relay.ts wait-on --budget-usd 40
bun scripts/relay.ts ms --budget-usd 40
bun scripts/relay.ts negotiator --control --budget-usd 40
bun scripts/relay.ts ms --learning --budget-usd 40
```

Muse Code is stopped after 10 tool calls or 300 seconds, whichever comes first (`--stop-after-steps`, `--stop-after-s`). In a learning run, Muse Code builds each task once, Glimmer reviews it, and the script approves both the change and any proposed skill, recorded as `by: "relay script (scripted owner-like approval)"`. The budget counts every host. The learn step's first host is Baseten, so check `costs.json` against the separate Baseten cap. The runner refuses to publish over an existing folder; `--name <folder>` publishes a new run under another name, as `negotiator-2` and `ms-2` were.

`bun test scripts/test/relay.test.ts` runs a dry relay, a dry control and a budget stop end to end on a local fixture. It also checks every run published in this folder: the agent order, the packet each run started from, a verification at the end, that every event validates and every hash chain holds, and that a control never reached the gate.
