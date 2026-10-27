# The demo

One task, four agents, one model family, three survivals. The beat sheet is in `AGENTS.md` section 2; this page is the runbook. The video shows a live run: `stint demo --live` drives the beats through the real daemon with real models. The replay judges click comes from that run, captured with `stint demo record`.

## The commands

| Command | What it does |
|---|---|
| `stint demo seed [--repo <path>]` | Sets up the three demo tasks on a fixture copy: T-0040 done with its review and its merge commit, T-0042 and T-0043 planned. Running it twice changes nothing. It refuses while a daemon runs for that repository. |
| `stint demo --live [--auto] [--allow-online] [--kill-after <seconds>]` | Runs the beats live on a fresh fixture copy with its own daemon. It seeds first, prints the URL to open, and pauses for Enter between beats unless `--auto`. It prints the kept repository path at the end. |
| `stint demo record --repo <path> --out <file>` | Turns a finished live workspace into a `stint.recording/1` file with real timings and `live: true`, with commit patches under `patches/` beside it. Local paths are scrubbed. |
| `stint demo [--path <file>] [--speed n] [--from mm:ss]` | Replays a recording with no keys and no Ollama. The header says "Replay of a live run on <date>" for a live recording. |

## Before the show

1. `scripts/bootstrap.sh --check-only` lists every adapter and host as available or not, with the reason.
2. `ollama list` shows `muse-glimmer:30b-mlx`; run one review the day before so the model is warm.
3. `stint demo --live` checks what it needs before it starts: `META_API_KEY`, Ollama with `muse-glimmer:30b-mlx` pulled (unless `--allow-online`), and `muse` on the PATH. It refuses to start and names the first missing one.
4. The browser is on the board at the URL the runner prints, dark theme, 1080p.

## The beats

The live runner runs these beats in order. Press Enter to move to the next one, or pass `--auto` for a rehearsal run.

| Time | Beat | What the runner does | What the screen shows |
|---|---|---|---|
| 0:00 | The folder is the task | seeds the tasks, starts the daemon, prints the URL | three tasks, plain JSON and markdown in `.stint/tasks/` |
| 0:12 | Plan the task | plans T-0042 with the planner chain | Muse Wonder's plan streams in; memory shows T-0040 as similar |
| 0:40 | Muse Code builds | assigns Muse Code as r2 | the worktree, the live diff, the cost meter, decisions land in `decisions.md` |
| 1:05 | Kill it | once a `src/` file has changed plus `--kill-after` seconds (6 by default), stops r2 through the daemon | the segment goes amber; the packet appears anyway: size and tokens, in-flight step unknown |
| 1:20 | A different agent finishes | hands T-0042 to the Stint agent and waits for its verification by the daemon | it checks the unknown step first; the verification card goes green: "33 passed, tests unchanged, run by the daemon" |
| 1:45 | Review offline | checks that the network is off (it asks, and refuses while online unless `--allow-online`), then reviews on Ollama | $0.00; a finding that contradicts a decision goes to the queue |
| 2:05 | Approve and merge | approves T-0042 through the gate | one merge commit with `Stint-Task: T-0042` |
| 2:15 | It learned | waits for the learn step, measures the proposed skill on T-0042 with it and without (two short runs on fresh copies; `--no-eval` skips this), approves it, then assigns T-0043, verifies and reviews it, and stops at awaiting approval | the skill card's eval line, "with skill: N findings, without: M"; `skill.applied` on T-0043; the review finds nothing on what was flagged before |
| 2:35 | Close | prints the per-task cost, the T-0042 packet tokens and hash, the URL, and the repository path to record from | the Factory's last panel: "Any harness, any model, one packet", every configured harness and host |

The times above are the script for the 2:35 video. A live run takes longer. The live take on 26 October (`demo/recordings/2026-10-26-1`) measured these, from the plan's start:

| Beat | Took | Ended at |
|---|---|---|
| Plan (Muse Wonder) | 32 s | 0:32 |
| Muse Code builds until the kill | 26 s | 0:58 |
| The packet, with the digest of the diff | 30 s | 1:28 |
| The Stint agent continues to green | 22 s, then 1 s of verification | 1:52 |
| The packet for the reviewer | 34 s | 2:26 |
| Review (that take ran it online) and the merge | 2 min 10 s | 4:36 |

A rehearsal on 27 October on the current build (`--auto --allow-online`, Glimmer preloaded) ran every beat in 9 min 14 s, the review on Glimmer offline included, at $0.26 for T-0042 and $0.19 for T-0043. Its learn step proposed nothing: the agents read the limit through `loadConfig()` as the fixture's AGENTS.md asks, so the review found no mistake that T-0040's review had found before, and a skill is proposed only for a mistake that recurs. Whether a take carries the learned skill depends on the model repeating that mistake; ADR-0011 keeps the hand-written replay as the default until one does. An earlier rehearsal that day stopped at the review because the continued run ended red; the runner now hands on again from the packet.

So the video cuts the waits, and the screen says it is a replay when it is one.

To rehearse one beat, `--from review` runs the beats before it without stopping and pauses from the review on; `--offline-plan` plans on the local model; `--take 2` records the finished run under `demo/recordings/<date>-2/`. After the run, or without `--take`, record it and keep the recording:

```
stint demo record --repo <printed path> --out demo/recordings/<date>.jsonl
stint demo --path demo/recordings/<date>.jsonl --speed 0
```

Anyone can replay that file with no keys. Replaying the recording made from the rehearsal run rebuilds the same T-0042 packet, with the same hash and token count.

## What can go wrong

| Problem | What you see | What to do |
|---|---|---|
| A key or model is missing | the runner refuses to start and names it | set the key, pull the model, or pass `--allow-online` to review on the hosted chain |
| The network is still on at the review beat | the runner asks for it off and refuses to review while online | turn Wi-Fi off and press Enter, or restart with `--allow-online` |
| The Meta API rate-limits the planner | the planner chip says it fell back to another host | nothing: the chain handles it, and that is worth saying on stage |
| Muse Code is slow to start | the segment stays "running" with no events | keep talking through the plan; the kill waits for the first `src/` change |
| The continued run ends red | "r3 ended with 2 tests failing; handing on from its packet." | nothing: the runner hands on from the packet that names the failing tests, up to three runs, and the review waits for a green one. Say so: it is the relay doing its job |
| Glimmer is cold | the review takes longer than 20 s | preload it before the show (a short `/api/generate` with `keep_alive` of 60m) and check `ollama ps`; a program that keeps another model loaded can push it out on a 32 GB machine |
| The live run misbehaves | anything unexpected | switch to `stint demo --from <beat>`: the replay of the rehearsal, labelled as a replay on screen |
| Wi-Fi does not come back | hosted legs show unavailable | the rest of the demo needs no network |
