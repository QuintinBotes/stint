# The video

This page is the script for the demo video, for whoever records and edits it: 2:45 at most, inside the hackathon's 3 minute limit, 1080p, captions burned in. Record the live run with `stint demo --live` and screen capture. If any segment is a replay, the strip under the top bar says so ("Replay, hand-written", or "A recording of a live run on <date>" for a recorded take), and that stays on screen. The voiceover is below; each line names what must be on screen while it plays.

Footage from the replay instead of a live take: `bun apps/web/scripts/capture-video.ts` plays the replay through the real daemon at 1.2x, switches the view on the replay's own clock in the order of the beats below, pans the Factory (`/factory`), ends on a title card, and writes a silent 1920x1080 MP4 to `.loop/video/`. It records in the dark charcoal theme whatever the machine's setting; for a screen capture of a live take, set the system to dark first, since the UI follows it. The strip under the top bar says "Replay, hand-written" for its whole length, so nobody takes it for a live run. The replay has no spec builder and no live relay, so record those two beats on their own (see the checklist), cut them in, and trim the replay footage to the times below.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 | The Board (`/`), three tasks | "I'm going to kill a coding agent halfway through a task, and another agent is going to finish it." |
| 0:08 | `.stint/tasks/T-0042` in the file browser, then the task view | "This is Stint, a software factory on your own machine, built on Meta's Muse models. The task is a folder in your repo, not a chat." |
| 0:18 | A live take of the spec builder: press n, type one sentence into "What do you want done?", choose Draft it; the questions, each with its recommended answer; the draft | "A task starts as one sentence. Muse Wonder asks only the questions that change what gets built, and drafts the spec." |
| 0:27 | Muse Wonder's plan arrives; Memory (press m) shows T-0040 as similar | "Muse Wonder plans it. Stint's memory finds the earlier task that hit the same problem." |
| 0:34 | Muse Code building on Muse Spark: the live diff, the cost meter, decision D3 | "Muse Code builds on Muse Spark, in its own git worktree. Every step lands on the timeline, and every token is priced." |
| 0:44 | The kill in the terminal pane; the segment ends red | "Now I kill it. Mid-edit." |
| 0:48 | The packet card: tokens, done, open, the in-flight step marked unknown | "The daemon doesn't ask the dead agent anything. It builds the packet from the log and the diff: a few hundred tokens. It even names the step that was in flight." |
| 1:01 | Hand to the Stint agent; it continues; the verification card on the Tests tab reads "33 passed, tests unchanged, run by Stint", green | "A different agent, the Stint agent on Muse Spark, picks it up from the packet alone. The daemon, not the agent, runs the tests: 33 passed, and the tests it is judged by are unchanged." |
| 1:15 | Wi-Fi off; Glimmer's review, $0.00; F2 goes to the queue beside D3 | "Review runs on the laptop with Muse Glimmer, network off, for nothing. One finding would undo a decision we made, so it waits for me instead of being applied." |
| 1:27 | Press `a` twice (the first gets Approve ready); the sign-off with the merge commit and its trailers | "I approve. That's a real merge, and the commit says which task, which runs and which packet." |
| 1:34 | The proposed skill with its eval line ("with skill: N findings, without: M"), approved; T-0043 runs with it; its review is clean | "The same finding showed up on two tasks, so Stint proposed a rule with the evidence and measured it with and without: both reviews clean, a fifth cheaper with it. I approve it, and the next task runs with it." |
| 1:50 | The Factory: runs by agent over time, then Meta models at work | "Here's the whole floor: who carried each task, and what they handed on. Every model is Meta's." |
| 1:57 | The relay table in `docs/proofs.md` ("Live evidence, 29 October") on GitHub, the three rows that reached the gate picked out, then one run's packets in `bench/relay/wait-on/tasks/T-0001/handoffs/` | "Then live, on three open-source repositories Stint had never seen: Muse Code, then Claude Code on Glimmer, then Codex on Muse Spark, each from the last one's packet. All three tasks reached the gate, hidden tests green." |
| 2:12 | The benchmark table in `docs/proofs.md` | "And we measured the packet: seven times smaller than the transcript, and runs that continued from it passed more often." |
| 2:21 | The "One packet, any agent" panel on the Factory: every configured agent and model host as chips | "Muse Code, the Stint agent, or any other harness. Muse Spark, Glimmer, or any other model. Any harness, any model, one packet." |
| 2:30 | The logo and the repository URL | "Stint. The task outlives the agent." |

It ends by 2:34, which leaves room under 2:45 for a pause at each cut-in.

## Captions

Captions are the voiceover lines, at most two lines on screen at a time. Numbers on screen must match the run being shown, so read them from that run's packet card and cost meter, not from this script. The relay beat's numbers are the ones in the table on screen, which names the file each comes from; say no number the table does not show.

## Checklist before recording

- Ollama has only Glimmer loaded (`ollama ps`); run one review first so it is warm.
- `META_API_KEY` is set; `muse --version` works.
- `stint demo seed` on a fresh fixture copy; the browser is on the Board at 1080p.
- Notifications are off; the terminal font is large enough to read at 1080p.
- The system is set to dark, so the UI shows the charcoal theme.
- For the spec builder beat: `stint up` on a fresh fixture copy with `META_API_KEY` set; the draft is one live Muse Wonder call.
- For the relay beat: `docs/proofs.md` open on GitHub at "Live evidence, 29 October", in the dark theme.
