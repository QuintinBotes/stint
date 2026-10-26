# Launch posts

Drafts for X, for the most-viral prize. Post the video with the first one, and attach `assets/social-card.png` when there is no video.

## The post

I killed a coding agent halfway through a task. Another agent finished it from a 412-token packet, and the tests passed.

Stint: a local software factory on Meta's Muse models. The task outlives the agent.

Built for the Meta AI Developer Hackathon.
github.com/QuintinBotes/stint

## A thread

1. Coding agents are great until the session ends: the context fills up, the process dies, the rate limit hits. Then the work is stuck in a transcript. Stint makes the task the unit of work instead of the chat.

2. Every run gets its own git worktree. When it ends, however it ends, the daemon writes a packet of a few hundred tokens: what is done, what is open, what was left out, what was refused, the decisions in force, and one ask for the next agent.

3. Muse Code builds on Muse Spark. Kill it, and Stint's own agent continues from the packet. The daemon runs the tests itself, so "done" is never an agent's claim.

4. Muse Glimmer reviews on the laptop, offline, for $0. A review finding that would reverse a decision waits for you.

5. We measured it: transcript against packet on five live tasks. The packet was 6x smaller to hand over, but the agent then re-read code. A quiz between two Muse models showed why, a diff digest fixed it, and the next run was 1.25x cheaper than the transcript.

6. It learns: when the same finding shows up on two tasks, it proposes a rule with the evidence. You approve it, and the next task gets it right.

Every model it calls is Meta's. MIT, local-first: github.com/QuintinBotes/stint
