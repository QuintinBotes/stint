# The video

This page describes Stint's demo film for judges and for anyone recording a new take: how to read it, how it was made, the cut with its voiceover, and the checklist before recording.

The film is [on YouTube](https://youtu.be/ejYyHgkVOWg). It runs 2:57.9 (the site rounds it to 2:58), inside the hackathon's 3 minute limit, at 1080p with captions burned in and "Forward Clarity" under it. Every picture of Stint at work is a live take, and every model in it is Meta's. The proof acts at the end show the repository's own evidence, each naming its source.

## Reading the film

The film cuts live takes from 30 and 31 October and two proof acts together, so a task id on screen does not always mean the same run. In order:

- **0:00 and 2:09, "nothing merges without you".** That is the default. A lane that approves low-risk changes by policy exists, and it stays off until you turn it on ([`sandbox.md`](sandbox.md#risk-and-the-auto-approve-lane)).
- **0:19 to 1:10 and 1:16 to 1:32, the Muse Code take of 30 October.** One goal, "Reliable webhook delivery" (G-0001), and its four tasks, T-0001 to T-0004.
- **0:44, the stop.** T-0001 is stopped mid-run and handed to the Stint agent with packet h1. The film does not follow that continuation to green. At 0:58 it moves on to T-0002, and T-0001 comes back at 1:24, where the Stint agent's run (r3) is red with "0 failed": its tests passed, but it changed a locked test file, so Stint turned the verification red and autopilot stopped for you ("Needs you: stint-agent r3 changed the acceptance tests"). That is the catch the voiceover names. The green hand-off is T-0009 at 1:58, where the Stint agent continues from packet h7 and Stint's tests report 67 passed, 0 failed.
- **0:58, "Muse Wonder 1.0 ✗ Failed" on T-0002.** The planner's call timed out on the Meta Model API and no fallback host answered, so T-0002 went on without a plan. Muse Code's build passed 34 tests, and Glimmer approved it.
- **1:10 to 1:16, the network-off take of 30 October.** A separate take of the same rate-limit task: its T-0001, handed on with packet h2, is reviewed by Glimmer with the network off. It is not the T-0001 stopped at 0:44.
- **1:33 to 2:13, takes 8 and 9 of 31 October.** A second goal, "Signed webhook deliveries" (G-0003), made in Stint's UI, with T-0008 to T-0011.
- **1:50 and 2:00, the two refusals.** The budget refusal quotes 150,000, the default before D-094, and the merge refusal prints the conflicting files as JSON. Both are fixed now; the list under the cut says how.
- **2:09, "All four merged" over "0 of 4 criteria met".** Every task merged and every criterion's tests pass, but Stint calls a criterion met only when a test showed it failing first, and this take set no such proofs. So `stint goal show G-0003` reads "Passes, not proven" for each criterion, and the goal stays in progress.
- **2:14, the memory graph,** is from the Muse Code take of 30 October.
- **2:21, the runs chart,** is a live relay on jeffbski/wait-on on 29 October, so its T-0001 is that repository's task. Claude Code and Codex are other vendors' agents, and here they run Meta's models, as the labels under their names say: Claude Code runs Muse Glimmer 30B through Ollama, and Codex runs Muse Spark 1.3 through the Meta Model API (`bench/relay/wait-on/relay.json`). Codex, the last of the three, wrote every green change.
- **2:34, the packet measured.** The 7x, the 9 of 10 against 3 of 5, and the 31% fewer input tokens that shows at 2:44 with no voiceover line are all from the bench of 27 October, in which each mode had its own first run. The controlled reruns of 2 November supersede them ([`proofs.md`](proofs.md#the-fair-rerun-2-november)), and the note under the cut gives their results.
- **The replay** that `stint demo` plays without keys is not the film. It tells a different, hand-written story, 2:35 long ([`demo.md`](demo.md#the-beats)).

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

**What the 2:21 and 2:34 lines rest on.** The relay line at 2:21 counts tasks: in those relays Codex, the last hop, wrote every green change ([`proofs.md`](proofs.md#live-evidence-29-october)). The packet line at 2:34 quotes the bench of 27 October, in which each mode had its own first run, so the packet and the transcript continued from different starting points. Rerun from one shared start on 2 November, every mode's code passed the held-out tests, and only the packet's runs all cleared the daemon's verification, 10 of 10 against 7 and 4, because only the packet carried the locked-test finding ([`proofs.md`](proofs.md#the-fair-rerun-2-november)). From genuinely unfinished checkpoints every mode finished the code, Muse Code resuming its own session included ([`proofs.md`](proofs.md#the-unfinished-rerun-2-november)).

**What the 0:44 and 2:46 lines cover.** At 0:44, "starts from that alone" means no transcript: the next agent's prompt holds the packet together with Stint's rules for the run, the task's goal and acceptance, the plan, the mounted skills and the changed files' line counts ([`packet.md`](packet.md#what-the-next-agent-reads)). At 2:46, "every model Stint calls is Meta's" holds for every default route and every recorded run, the film's takes included; the agent presets that could reach another vendor's model ship disabled ([`agents.md`](agents.md)).

Takes 7 to 9 found three defects that would have stopped a real user. All three are fixed in the code, and the film shows two of them as they were in the take:

- One Glimmer review of a 27 KB diff took 185 s on a 32 GB Mac, over the 120 s review limit. A host now sets its own `timeoutMs`, and Ollama's is 10 minutes (D-093).
- The implementer token budget of 150,000 refused every task's second build or hand-off, and nothing let a person raise it. The default is now 1,200,000, and `stint limits <task> --implementer-tokens N` raises it, as the refusal says (D-094). At 1:50 the refusal still quotes T-0009's budget of 150,000, and at 1:54 the take raises it with `stint limits`.
- The gate printed a merge conflict's files as JSON. It now names them and says to ask for changes so an agent merges main. The take predates that fix: at 2:00 to 2:04 the refusal reads `conflicts with main: {"files": [...]}`.

## Captions

Captions are the voiceover lines, at most two lines on screen at a time, in the band under the picture. Every number in a take is that take's own, read off its live run; the takes' event logs are not in this repository. The proof acts name the file in this repository that each of their numbers comes from, and the voiceover says no number the picture does not show.

## Checklist before recording

- The Mac is unlocked and stays awake: screen capture stops when the screen locks.
- Ollama has only Glimmer loaded (`ollama ps`); run one review first so it is warm.
- `META_API_KEY` is set, and `muse --version` works.
- `stint up --no-review` runs in the take's repository, so `stint review` is the person's to run, and `autopilot.parallel` is 2.
- Notifications are off, and the terminal font is large enough to read at 1080p.
- The system is set to dark, so the UI shows the charcoal theme.
