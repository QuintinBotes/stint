# The video

2:30 target, 2:40 cap, 1080p, dark theme, captions burned in. Record the live run with `stint demo --live` and screen capture. If any segment is a replay, the header says "Replay of a live run on <date>", and that stays on screen. The voiceover is below; each line names what must be on screen while it plays.

Footage from the replay instead of a live take: `bun apps/web/scripts/capture-video.ts` plays the replay through the real daemon at 1.2x, which puts its beats on the times below, switches the view on the replay's own clock, pans the Factory, ends on a title card, and writes a silent 1920x1080 MP4 to `.loop/video/`. The strip under the top bar says "Replay, hand-written" for its whole length, so nobody takes it for a live run.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 | The board, three tasks | "I'm going to kill a coding agent halfway through a task, and another agent is going to finish it." |
| 0:08 | `.stint/tasks/T-0042` in the file browser, then the task view | "This is Stint, a software factory on your own machine, built on Meta's Muse models. The task is a folder in your repo, not a chat." |
| 0:20 | Muse Wonder's plan arrives; the memory panel shows T-0040 as similar | "Muse Wonder plans it. Stint's memory finds the earlier task that hit the same problem." |
| 0:32 | Muse Code building on Muse Spark: the live diff, the cost meter, decision D3 | "Muse Code builds on Muse Spark, in its own git worktree. Every step lands on the timeline, and every token is priced." |
| 0:50 | The kill in the terminal pane; the segment ends red | "Now I kill it. Mid-edit." |
| 0:55 | The packet card: tokens, done, open, the in-flight step marked unknown | "The daemon doesn't ask the dead agent anything. It builds the packet from the log and the diff: a few hundred tokens. It even names the step that was in flight." |
| 1:10 | Hand to the Stint agent; it continues; the verification card reads "33 passed, tests unchanged, run by the daemon", green | "A different agent, Stint's own agent on Muse Spark, picks it up from the packet alone. The daemon, not the agent, runs the tests: 33 passed, and the tests it is judged by are unchanged." |
| 1:30 | Wi-Fi off; Glimmer's review, $0.00; F2 goes to the queue beside D3 | "Review runs on the laptop with Muse Glimmer, network off, for nothing. One finding would undo a decision we made, so it waits for me instead of being applied." |
| 1:48 | Press `a`; the sign-off with the merge commit and its trailers | "I approve. That's a real merge, and the commit says which task, which runs and which packet." |
| 1:58 | The proposed skill with its eval line ("with skill: N findings, without: M"), approved; T-0043 runs with it; its review is clean | "The same finding showed up on two tasks, so Stint proposed a rule, with the evidence, and measured it on a real run with it and without: both reviews came back clean, and the run with it cost a fifth less. I approve it, and the next task gets it right the first time." |
| 2:12 | The Factory: the relay, then Meta models at work | "Here's the whole floor: who carried each task, and what they handed on. Every model is Meta's." |
| 2:22 | The benchmark table in the README | "And we measured it. The packet is seven times smaller than the transcript. Our first one made agents re-read code, so we fixed it, and now it costs less and passes more often." |
| 2:30 | The Factory's last panel: every configured harness and host as chips | "Muse Code, Stint's agent, or any other harness. Muse Spark, Glimmer, or any other model. Any harness, any model, one packet." |
| 2:36 | The logo and the repository URL | "Stint. The task outlives the agent." |

## Captions

Captions are the voiceover lines, at most two lines on screen at a time. Numbers on screen must match the run being shown, so read them from that run's packet card and cost meter, not from this script.

## Checklist before recording

- Ollama has only Glimmer loaded (`ollama ps`); run one review first so it is warm.
- `META_API_KEY` is set; `muse --version` works.
- `stint demo seed` on a fresh fixture copy; the browser is on the board at 1080p.
- Notifications are off; the terminal font is large enough to read at 1080p.
