# Launch posts

This page holds the launch posts for X, for whoever posts them for the most-viral prize: one post and a thread. Post the video with the first one, or attach `assets/social-card.png` when there is no video. Each post is 280 characters or fewer, counting a link as 23, and makes no claim that depends on which take the video shows.

## The post

I killed a coding agent halfway through a task. Another agent finished it from a packet of a few hundred tokens, and the tests passed.

Stint runs on Meta's Muse models, on your own machine. The task outlives the agent.

Meta Global AI Developer Hackathon
github.com/QuintinBotes/stint

## A thread

1. Coding agents are good until the session ends: the context fills up, the process dies, the rate limit hits. Then the work is stuck in a transcript. Stint makes the task the unit of work instead of the chat.

2. Every run gets its own git worktree. When it ends, however it ends, the daemon writes a packet of a few hundred tokens: what is done, what is open, what was left out, what was refused, the decisions in force, and one ask for the next agent.

3. Muse Code builds on Muse Spark. Kill it, and the Stint agent continues from the packet. The daemon runs the tests itself, so "done" is never an agent's claim.

4. Muse Glimmer reviews on the laptop, offline, for $0. A review finding that would reverse a decision waits for you.

5. Measured live on five tasks, from one shared start: runs from the packet cleared the daemon's verification 10 of 10, from the transcript 7, from the task and the diff 4. Every mode's code passed the held-out tests; only the packet told the next agent a locked test had changed.

6. Then we ran it live on three open-source repos Stint had never seen. Each task went from Muse Code to Claude Code on Glimmer to Codex on Muse Spark, each from the last one's packet. 3 of 5 relays reached the gate with the hidden tests green. Codex wrote every green change.

7. The honest part: single runs of our own agent on Muse Spark Open passed the hidden tests 3 of 9. The relays used other agents and models, so that is no controlled comparison. And the offline review approved all 5 failing patches it saw: the hidden tests are the gate.

8. It learns: when the same finding shows up on two tasks, it proposes a rule with the evidence, measures it on a real run with and without, and waits for you to approve it. On a live run of seven tasks nothing recurred, so it proposed nothing.

9. It looks, too. A criterion can be a page: Stint opens it, Muse Spark judges the screenshot, and SAM 3.1 boxes what is wrong. On ten live pages it caught 4 of 5 seeded defects and failed none of 5 clean ones, for under 5 cents.

By default every model it calls is Meta's. MIT, local-first: github.com/QuintinBotes/stint
