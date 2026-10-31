# The video

This page describes Stint's demo film for judges and for anyone recording a new take: how it was made, the cut with its voiceover, and the checklist before recording.

The film is [on YouTube](https://youtu.be/ejYyHgkVOWg). It runs 2:57.9, inside the hackathon's 3 minute limit, at 1080p with captions burned in and "Forward Clarity" under it. Every picture of Stint at work is a live take, and every model in it is Meta's. The proof acts at the end show the repository's own evidence, each naming its source.

## How it was made

Each take ran on a stage page: a real terminal on the left and Stint's UI on the right, both driven by a script at a person's pace while videoFn recorded the window. The edit adds zooms where something has to be read, a speed badge on every stretch that is not real time, and an "N min later" pill wherever time jumps.

- **The Muse Code take, 30 October.** Muse Code (read-only profile) drives Stint over MCP while Stint's UI shows the same goal.
- **The network-off take, 30 October.** Muse Glimmer reviews on this machine with the network off, for $0.00.
- **Takes 8 and 9, 31 October.** A goal made in Stint's UI and followed in a terminal with `stint watch`. Glimmer reviewed every task on the laptop, and the person answered every gate.

## The cut

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 | The title sequence | "Coding agents stop: they crash, hit a limit, or run out of context, and the work dies with the session. Stint is a software factory on your own machine, built on Meta's Muse models. Any agent can pick up the task, and nothing merges without you. The task outlives the agent." |
| 0:19 | Muse Code, left; Stint's UI, right: the request, Muse Code asking to use Stint's tools, the goal page with four tasks that wait on each other | "Here's Stint inside Muse Code. I ask for something bigger than one task: make webhook delivery reliable. Muse Code calls Stint's tools. Stint makes it a goal, and its planner splits it into four tasks, each waiting on the one it needs." |
| 0:38 | The board as agents build | "Stint's agents build them, each in its own worktree, while the board keeps up." |
| 0:44 | The stop request in Muse Code, the killed run, its packet | "I tell Muse Code to stop one mid-run and hand it to the Stint agent. Stint builds the packet from the log and the diff, and the next agent starts from that alone." |
| 0:57 | Glimmer's review on this machine, the gate armed, merged; the next task starting | "Every change is tested by Stint and reviewed by Muse Glimmer on this laptop, for nothing. I approve, and each merge unlocks the next task." |
| 1:11 | The network-off take: the Offline pill and Glimmer's review | "It even works with the network off." |
| 1:17 | The review's two findings against the task's decisions; the tampered acceptance tests; both sent back | "And it doesn't trust the agents. The review caught a build that broke two of the task's own decisions, and Stint caught an agent rewriting the tests it is judged by. Both go back, with the reason as the next ask." |
| 1:33 | Chapter 09: one sentence in the spec builder, the draft, the goal's four tasks | "Or start from Stint's own UI. One sentence becomes a goal, and the planner splits it into four tasks." |
| 1:41 | Chapter 10: two tasks building at once, the terminal following every task, Glimmer's approve, merged | "Two tasks build at once, and one terminal follows every task. Glimmer reviews each one, and three merge." |
| 1:49 | The hand-off refused over the task's token budget, `stint limits T-0009 --implementer-tokens 600000` in the terminal, the Stint agent continuing, 67 passed | "The fourth gets stuck. Handing it on hits the task's token budget, so I raise it from the terminal, and the Stint agent picks it up from the packet." |
| 1:59 | The approve refused: the branch conflicts with main; sent back to merge main; 132 passed | "Then the merge is refused: the other three changed the same files. I send it back, Muse Code merges main, and Glimmer approves." |
| 2:09 | Chapter 11, "All four merged": the last approve, `stint goal show G-0003` | "Four tasks, one goal, and nothing merged without me." |
| 2:14 | Chapter 12, "What Stint remembers": the workspace memory graph growing as its slider runs (the Muse Code take of 30 October) | "And Stint's memory grows with every task: files, decisions, findings and runs, linked." |
| 2:21 | The runs chart of a live relay on jeffbski/wait-on | "It works across agents, too. On three projects Stint had never seen, three different agents carried each task on from the last one's packet, and all three tasks reached the gate with hidden tests green." |
| 2:34 | The packet, measured (`docs/proofs.md`, live 27 October) | "Against handing over the whole transcript, the packet is about seven times smaller, and runs that continued from it passed nine times in ten, against three in five." |
| 2:46 | Every model is Meta's | "Every model Stint calls is Meta's, and two are open weights, one running on your own laptop." |
| 2:52 | Stint, "The task outlives the agent.", the repository | |

**A correction in this cut.** The first upload said four relays out of five reached the gate. Four of the five relays passed the hidden tests, but three reached the gate: the first vercel/ms relay went green and stopped when Glimmer's review timed out (`bench/relay/ms/relay.json`). This cut counts tasks, and all three reached the gate; [`proofs.md`](proofs.md#live-evidence-29-october) has every relay.

At the end of chapter 11 the goal reads "in progress": every task merged and every criterion's tests pass, but Stint calls a criterion met only when a test showed it failing first, and this take set no such proofs. That is why the chapter says "All four merged".

Takes 7 to 9 found three defects that would have stopped a real user, and each was fixed before the take that shows it:

- One Glimmer review of a 27 KB diff took 185 s on a 32 GB Mac, over the 120 s review limit. A host now sets its own `timeoutMs`, and Ollama's is 10 minutes (D-093).
- The implementer token budget of 150,000 refused every task's second build or hand-off, and nothing let a person raise it. The default is now 1,200,000, and `stint limits <task> --implementer-tokens N` raises it, as the refusal says (D-094).
- The gate printed a merge conflict's files as JSON. It now names them and says to ask for changes so an agent merges main.

## Captions

Captions are the voiceover lines, at most two lines on screen at a time, in the band under the picture. Every number on screen is the take's own. The proof acts name the file each number comes from, and the voiceover says no number the picture does not show.

## Checklist before recording

- The Mac is unlocked and stays awake: screen capture stops when the screen locks.
- Ollama has only Glimmer loaded (`ollama ps`); run one review first so it is warm.
- `META_API_KEY` is set, and `muse --version` works.
- `stint up --no-review` runs in the take's repository, so `stint review` is the person's to run, and `autopilot.parallel` is 2.
- Notifications are off, and the terminal font is large enough to read at 1080p.
- The system is set to dark, so the UI shows the charcoal theme.
