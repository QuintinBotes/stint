# The video

This page is the script for the demo video, for whoever records and edits it: 2:45 at most, inside the hackathon's 3 minute limit, 1080p, captions burned in. Record the live run with `stint demo --live` and screen capture. If any segment is a replay, the strip under the top bar says so ("Replay, hand-written", or "A recording of a live run on <date>" for a recorded take), and that stays on screen. The voiceover is below; each line names what must be on screen while it plays.

Footage from the replay instead of a live take: `bun apps/web/scripts/capture-video.ts` plays the replay through the real daemon at 1.2x, switches the view on the replay's own clock in the order of the beats below, pans the Factory (`/factory`), ends on a title card, and writes a silent 1920x1080 MP4 to `.loop/video/`. It records in the dark charcoal theme whatever the machine's setting; for a screen capture of a live take, set the system to dark first, since the UI follows it. The strip under the top bar says "Replay, hand-written" for its whole length, so nobody takes it for a live run. The replay has no spec builder and no live relay, so record those two beats on their own (see the checklist), cut them in, and trim the replay footage to the times below.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 | The Board, then the spec builder: one sentence typed into "What do you want done?", the questions with their recommended answers, the draft | "I'm going to kill a coding agent halfway through a task, and another agent is going to finish it. This is Stint, a software factory on your own machine, built on Meta's Muse models. A task starts as one sentence. Muse Spark asks only the questions that change what gets built, and drafts the spec." |
| 0:22 | Muse Wonder's plan arrives; Memory (press m) shows the earlier task as similar | "Muse Wonder plans it, and Stint's memory finds the earlier task that hit the same problem." |
| 0:32 | Muse Code building on Muse Spark, the kill, the packet card with its size, the Stint agent continuing, the Tests tab green | "Muse Code builds on Muse Spark, in its own git worktree, and every token is priced. Now I kill it. Mid-edit. The daemon doesn't ask the dead agent anything: it builds a packet of a few hundred tokens from the log and the diff. A different agent, the Stint agent, picks it up from the packet alone, and the daemon, not the agent, runs the tests: 31 passed." |
| 0:56 | Wi-Fi off; Glimmer's review: "On this machine" | "Review runs on the laptop with the network off: Muse Glimmer, about a minute, for nothing." |
| 1:06 | Approve; "Merged" in the header; "Approved by you and merged into main as" its commit | "I approve. That's a real merge, and the commit says which task, which runs and which packet." |
| 1:16 | The Skills page of the replay, its "Replay, hand-written" strip in frame: the learned skill, the two findings it came from, its with and without line | "When the same finding shows up on two tasks, Stint proposes a rule with the evidence and measures it with and without. This take had nothing to learn, so this is the replay; the measurement is from a live run on 27 October." |
| 1:32 | A terminal: `stint list`, `stint packet T-0042 --as prompt`, `stint costs --by task` | "It all works from the terminal: the board, the packet any agent can read, and what each task cost." |
| 1:40 | `muse exec` asked to use the Stint tools; its answer; `stint list` with the new task; the task on the Board | "And any harness that speaks MCP can drive it. Muse Code reads the board through Stint's tools, finds the similar past task, and files a new one, with its acceptance criteria." |
| 1:56 | The Factory: the top numbers, runs by agent with the packet between them, One packet, any agent, Meta models at work | "Here's the whole floor: who carried each task, the packet they passed on, and every model is Meta's." |
| 2:06 | The relay table in `docs/proofs.md` on GitHub, then one packet in `bench/relay/wait-on/tasks/T-0001/handoffs/` | "Then live, on three open-source repositories Stint had never seen: Muse Code, then Claude Code on Glimmer, then Codex on Muse Spark, each from the last one's packet. Four relays out of five reached the gate with hidden tests green, and the one that didn't is in the table too." |
| 2:25 | The benchmark table and the paragraph under its chart in `docs/proofs.md` | "And we measured the packet: about seven times smaller than the transcript, and runs that continued from it passed more often." |
| 2:36 | Stint, "The task outlives the agent.", the repository URL | "Stint. The task outlives the agent." |

The cut of 30 October runs 2:41. Every beat but one is the live take of that day; the learned skill is the replay, because that take's two reviews found nothing, so nothing recurred and the learn step rightly proposed no skill. The numbers spoken are the ones on screen in that take.

## Captions

Captions are the voiceover lines, at most two lines on screen at a time. Numbers on screen must match the run being shown, so read them from that run's packet card, not from this script. The relay beat's numbers are the ones in the table on screen, which names the file each comes from; say no number the table does not show.

## Checklist before recording

- Ollama has only Glimmer loaded (`ollama ps`); run one review first so it is warm.
- `META_API_KEY` is set; `muse --version` works.
- `stint demo seed` on a fresh fixture copy; the browser is on the Board at 1080p.
- Notifications are off; the terminal font is large enough to read at 1080p.
- The system is set to dark, so the UI shows the charcoal theme.
- For the spec builder beat: `stint up` on a fresh fixture copy with `META_API_KEY` set; the draft is one live Muse Wonder call.
- For the relay beat: `docs/proofs.md` open on GitHub at "Live evidence, 29 October", in the dark theme.
