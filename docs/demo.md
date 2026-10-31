# The demo

This page is the runbook for whoever presents the demo: the commands, the checks before the show, the beats, and what to do when one goes wrong.

The story is one task, four agents, one model family and three survivals; the beat sheet is in `AGENTS.md` section 2. `stint demo --live` drives the beats through the real daemon with real models, and `stint demo record` turns a finished live run into a recording. The replay that judges click, `demo/recording.jsonl`, is hand-written and says so on screen until a live take with the network off replaces it ([ADR-0011](adr/0011-default-replay-until-live-take.md)).

## The commands

| Command | What it does |
|---|---|
| `stint demo seed [--repo <path>]` | Sets up the three demo tasks on a fixture copy: T-0040 done, with its review and its merge commit, and T-0042 and T-0043 planned. Running it twice changes nothing. It refuses while a daemon runs for that repository. |
| `stint demo --live [--auto] [--allow-online] [--kill-after <seconds>]` | Runs the beats live on a fresh fixture copy with its own daemon. It seeds first, prints the URL to open, and pauses for Enter between beats unless `--auto` is set. At the end it prints the path of the kept repository. |
| `stint demo record --repo <path> --out <file>` | Turns a finished live workspace into a `stint.recording/1` file with real timings and `live: true`, with commit patches under `patches/` beside it. Local paths are scrubbed. |
| `stint demo [--path <file>] [--speed n] [--from mm:ss]` | Replays a recording with no keys and no Ollama. For a live recording, the strip under the top bar says "A recording of a live run on <date>". |

## The judge copy

`bun run build:judge` builds the GitHub Pages site into `apps/web/dist-judge/`: the landing page (`apps/web/landing/index.html`) at its root, and a read-only copy of the Board under `demo/`. For the copy, it plays the replay into a daemon as `stint demo` does, drives the real UI through every page, task, tab and view while recording each read, and builds the UI around that snapshot. Nothing in the copy calls a daemon or a model. Approve is off with the reason "This is a read-only copy of the recorded story. Install Stint to run it.", and every other change is refused with the same words. The strip still says "Replay, hand-written".

`bun run serve:judge` serves the site as Pages would, the landing page at `http://127.0.0.1:4321/stint/` and the Board at `http://127.0.0.1:4321/stint/demo/` (`STINT_JUDGE_PORT` picks another port). A deep link into the Board is answered by the root `404.html`, which boots it. `bun run test:judge` builds the site and checks both in a browser. The live site is https://quintinbotes.github.io/stint/.

The workflow `.github/workflows/judge.yml` builds, checks and deploys the copy on a push to main, but only when the repository variable `JUDGE_PAGES` is `on` (and Pages takes its source from GitHub Actions). Otherwise every run is skipped.

## Before the show

1. `scripts/bootstrap.sh --check-only` lists every adapter and host as available or not, with the reason.
2. `ollama list` shows `muse-glimmer:30b-mlx`. Run one review the day before so the model is warm.
3. `stint demo --live` checks what it needs before it starts: `META_API_KEY`, Ollama with `muse-glimmer:30b-mlx` pulled (unless `--allow-online`), and `muse` on the PATH. It refuses to start and names the first one missing.
4. The browser is on the Board (`/`) at the URL the runner prints, at 1080p.
5. The laptop stays open and on power. `stint demo --live` holds off idle sleep, but a closed lid still sleeps the machine and drops the network mid-run ([ADR-0008](adr/0008-live-runs-and-sleep.md)).

## The beats

The live runner runs these beats in order. Press Enter to move to the next one, or pass `--auto` for a rehearsal.

| Time | Beat | What the runner does | What the screen shows |
|---|---|---|---|
| 0:00 | The folder is the task | Seeds the tasks, starts the daemon, prints the URL | Three tasks, plain JSON and markdown in `.stint/tasks/` |
| 0:12 | Plan the task | Plans T-0042 with the planner chain | Muse Wonder 1.0's plan streams in; Memory (press m) shows T-0040 as similar |
| 0:40 | Muse Code builds | Assigns Muse Code as r2 | The worktree, the live diff, decisions landing in `decisions.md` |
| 1:05 | Kill it | Once a `src/` file has changed, waits `--kill-after` seconds (6 by default), then stops r2 through the daemon | A red notice says the run was killed; the packet appears anyway, with its size and tokens and the in-flight step unknown |
| 1:20 | A different agent finishes | Hands T-0042 to the Stint agent and waits for the daemon's verification | It checks the unknown step first; the verification card on the Tests tab goes green: "33 passed, tests unchanged, run by Stint" |
| 1:45 | Review offline | Checks that the network is off (it asks, and refuses while online unless `--allow-online`), then reviews on Ollama | A finding that contradicts a decision goes to the queue |
| 2:05 | Approve and merge | Keeps D3 against the queued finding (approve waits while a finding that would reverse a decision is queued), then approves T-0042 through the gate | One merge commit with `Stint-Task: T-0042` |
| 2:15 | It learned | Waits for the learn step and measures the proposed skill on T-0042 with and without it (two short runs on fresh copies; `--no-eval` skips this). It approves the skill, then assigns T-0043, verifies and reviews it, and stops at awaiting approval. | The skill card's eval line, "with skill: N findings, without: M"; `skill.applied` on T-0043; the review finds nothing on what was flagged before |
| 2:35 | Close | Prints the per-task cost, the T-0042 packet's tokens and hash, the URL, and the repository path to record from | The "One packet, any agent" panel on the Factory (`/factory`): every configured agent and model host |

These times are the script for the 2:35 video; a live run takes longer. The live take on 26 October (`demo/recordings/2026-10-26-1`) measured these, from the plan's start:

| Beat | Took | Ended at |
|---|---|---|
| Plan (Muse Wonder 1.0) | 32 s | 0:32 |
| Muse Code builds until the kill | 26 s | 0:58 |
| The packet, with the digest of the diff | 30 s | 1:28 |
| The Stint agent continues to green | 22 s, then 1 s of verification | 1:52 |
| The packet for the reviewer | 34 s | 2:26 |
| Review (that take ran it online) and the merge | 2 min 10 s | 4:36 |

A rehearsal on 27 October (`--auto --allow-online`, with Muse Glimmer preloaded) ran every beat in 9 min 14 s, including the offline review on Muse Glimmer, at $0.26 for T-0042 and $0.19 for T-0043. Its learn step proposed nothing. The agents read the limit through `loadConfig()`, as the fixture's `AGENTS.md` asks, so the review found none of the mistakes T-0040's review had found, and Stint proposes a skill only for a mistake that recurs. Whether a take carries the learned skill depends on the model repeating that mistake, so ADR-0011 keeps the hand-written replay as the default until one does.

The video therefore cuts the waits, and the screen says it is a replay when it is one.

To rehearse one beat, `--from review` runs the beats before it without stopping and pauses from the review on. The beat names are `plan`, `build`, `hand`, `review`, `approve` and `next`. `--offline-plan` plans on the local model, and `--take 2` records the finished run under `demo/recordings/<date>-2/`. After the run, or without `--take`, record it and keep the recording:

```bash
stint demo record --repo <printed path> --out demo/recordings/<date>.jsonl
stint demo --path demo/recordings/<date>.jsonl --speed 0
```

Anyone can replay that file with no keys. Replaying the recording made from the rehearsal run rebuilds the same T-0042 packet, with the same hash and token count.

## What can go wrong

| Problem | What you see | What to do |
|---|---|---|
| A key or model is missing | The runner refuses to start and names it | Set the key, pull the model, or pass `--allow-online` to review on the hosted chain |
| The network is still on at the review beat | The runner asks for it off and refuses to review while online | Turn Wi-Fi off and press Enter, or restart with `--allow-online` |
| The Meta Model API rate-limits the planner | The planner chip says it fell back to another host | Nothing: the chain handles it, and that is worth saying on stage |
| Muse Code is slow to start | The segment stays "running" with no events | Keep talking through the plan; the kill waits for the first `src/` change |
| The continued run ends red | "r3 ended with 2 tests failing; handing on from its packet." | Nothing: the runner hands on from the packet that names the failing tests, up to three runs, and the review waits for a green one. Say so: it is the relay doing its job |
| Muse Glimmer is cold | The review takes longer than 20 s | Preload it before the show (a short `/api/generate` with `keep_alive` of 60m) and check `ollama ps`; a program that keeps another model loaded can push it out on a 32 GB machine |
| The live run misbehaves | Anything unexpected | Switch to the replay at that beat's time, such as `stint demo --from 1:45`; it is labelled as a replay on screen |
| Wi-Fi does not come back | Hosted legs show unavailable | The rest of the demo needs no network |
