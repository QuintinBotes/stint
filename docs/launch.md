# Launch posts

Drafts for X, for the most-viral prize. Post the video with the first one, and attach `assets/social-card.png` when there is no video. Each post is 280 characters or fewer, counting a link as 23, and makes no claim that depends on which take the video shows.

## The post

I killed a coding agent halfway through a task. Another agent finished it from a packet of a few hundred tokens, and the tests passed.

Stint runs on Meta's Muse models, on your own machine. The task outlives the agent.

Meta Global AI Developer Hackathon
github.com/QuintinBotes/stint

## A thread

1. Coding agents are great until the session ends: the context fills up, the process dies, the rate limit hits. Then the work is stuck in a transcript. Stint makes the task the unit of work instead of the chat.

2. Every run gets its own git worktree. When it ends, however it ends, the daemon writes a packet of a few hundred tokens: what is done, what is open, what was left out, what was refused, the decisions in force, and one ask for the next agent.

3. Muse Code builds on Muse Spark. Kill it, and Stint's own agent continues from the packet. The daemon runs the tests itself, so "done" is never an agent's claim.

4. Muse Glimmer reviews on the laptop, offline, for $0. A review finding that would reverse a decision waits for you.

5. Measured on five live tasks: runs that continued from the packet passed 9 of 10, runs from the full transcript 3 of 5, on 31% fewer input tokens. A quiz between two Muse models got us there: our first packet named the files, not what the code did.

6. It learns: when the same finding shows up on two tasks, it proposes a rule with the evidence, measures it on a real run with and without, and waits for you to approve it.

Every model it calls is Meta's. MIT, local-first: github.com/QuintinBotes/stint
