# The factory

This page is for anyone who wants the whole picture: what each screen of the web UI shows, and the loop Stint runs around every hand-off.

## What you see

The top bar holds Board, Goals, Factory and Skills, then search (Cmd+K opens the command palette, which names the command each action runs in a terminal), one status button for Stint, its agents and its models, and Help. Every status label draws a shape beside its word, so no state rests on colour. The UI follows the system's light or dark setting. Dialogs have a visible Close, keep their actions in a footer, and ask "Discard this draft?" before Escape or a click outside drops what you typed.

- **Board** (`/`): a sentence under the title says what needs you and why ("T-0043 waits for your approval."), or that nothing does. Counts of tasks that need you, are running and are planned sit beside it, with the decisions waiting kept apart, since a decision is not a task. The tasks are in four groups:
  - Needs you: waiting for your approval, rejected, stopped by autopilot to ask you, or waiting on a permission question from an agent, labelled with the tool;
  - Planned, with the task a planned task waits on;
  - In progress: building, verifying, reviewing, or in PR review;
  - Closed: merged, approved or abandoned.

  Each card has one status label, one summary or blocker line, the daemon's test result once there is one, and who worked on it and how long. A task that never ran shows its goal, not a summary. A task made from a goal says "Part of G-0001, covers criterion 2". The header's main action is Review for the oldest task waiting for approval, else Run all for the planned tasks, else New task. Run all asks first: which tasks start now and which wait, the most builds any may use, the spend cap across them when every one has a spend limit, and that nothing merges without you. Only Start starts them, and the palette asks the same question. Issues pulled from GitHub or Linear wait in an intake panel until you accept them.
- **Task view** (`/t/<task>`): the title block across the top, with the task's state, its one next action (Approve and merge at the gate, Stop while a run is live, Start on autopilot for a planned task), its goal and the tasks it waits on, its runs, and a meter for each of its [limits](#limits-you-set), spend only once it has a spend limit. While the clock looks back, a notice says "You are looking at T-0042 as it was at 2:12" with Return to latest, and every action, key and palette command that would change something waits until you return. The runs are on the left, one agent after another with every hand-off, with a clock above them that goes back in time and the revision block under them. The approval gate closes that block: it opens only on a green verification, says what was red when it is not (failed tests out of the total, held-out scenarios, tampered tests or a check by name), and shows the change's risk tier and how the task went ([`metrics.md`](metrics.md#how-it-went)). While a review finding that would reverse a decision waits, the gate lists it and Approve holds, with the reason. Request changes and Reject wait until something has been built: before that there is nothing to send back. In the middle, Sharpen's questions while a task has them ([`sharpen.md`](sharpen.md)), then the tabs:
  - Changes, the diff; Files, the worktree's files with "Open in your editor";
  - Terminal, a terminal in the worktree;
  - Plan and Packet;
  - Review, one row per lens;
  - Tests, the daemon's verification: "33 passed, tests unchanged, run by Stint", and under "What Stint saw" each visual check's screenshot and verdict ([`verify.md`](verify.md#what-stint-saw-visual-checks)).

  Memory opens beside the work on request (the Memory button, or m): similar tasks and the decisions that constrain this one, as they stood at the clock's time. A merged, rejected or abandoned task shows how it went under its title block. On a phone the gate and the tabs come before the runs.
- **Goals** (`/goals`, between Board and Factory in the top bar): outcomes bigger than one task. The list shows each goal's status, how many of its criteria are met and its tasks. A goal's page shows its outcome, each criterion with its state and the tasks covering it, Sharpen, Split into tasks, the tasks with how each went, its build meter (and its spend meter once it has a spend limit) with "Change the goal's limits", "Run the goal's tasks", and "Abandon this goal" ([`sharpen.md`](sharpen.md#goals)). Each task row shows its own status and what it waits for.
- **Factory** (`/factory`): what the agents did in three figures, the agents table, then named groups that open on request: who carried each task and what they handed on, and which Muse model did what. Also there:
  - a scoreboard per agent and model;
  - outcomes after merge (reverts, follow-ups, failing CI);
  - the auto-approve lane's shadow record;
  - scheduled upkeep;
  - every harness and host this workspace can use.
- **Skills** (`/skills`): what the agents load before a run, learned or written by hand, with evidence, an eval with and without, and a track record.

<p align="center"><img alt="The Factory in the replay: what the agents did over 30 days in four figures (1 task merged, $0.76 this week, 50% passed the tests first time, 100% of hand-offs passed), the agents table for the Stint agent and Muse Code, and the decision waiting for you below it" src="../assets/screenshot-factory.png" width="900"></p>

## The loop around the hand-off

Each part has its own page:

- **Verification an agent cannot fake.** The daemon runs the tests and the configured checks. The test files a task names are locked at plan time, so an agent that weakens them fails. Held-out scenarios run in a checkout the agent never sees ([`verify.md`](verify.md)).
- **Hand-offs that get smarter.**
  - A task escalates after repeated failures.
  - Best of n builds candidates in parallel and keeps the best green one.
  - No model reviews its own work.
  - Reviews run per lens: general, security and spec fit ([`agents.md`](agents.md)).
- **Plans that remember.** The planner reads similar tasks and the decisions on the files it will touch. It splits big tasks into subtasks that run in dependency order.
- **A clear start, and limits you set.** Before work starts, Sharpen asks the few questions that change what gets built and records your answers as decisions ([`sharpen.md`](sharpen.md)). Autopilot stops and asks you before a task would pass one of its [limits](#limits-you-set), or its goal's.
- **How each task went.** One record per task says, for each criterion, whether it was proven, only passes, fails or waits for you, with the loops, the spend and what happened after merge ([`metrics.md`](metrics.md#how-it-went)).
- **Learning that is measured.** A learned skill starts on probation, carries an eval with and without it, and is proposed for retirement if it hurts. Golden tasks report pass@1 and pass^3 ([`evals.md`](evals.md)).
- **After merge.** Reverts, follow-up work, failing CI and incidents are linked to the task that caused them. Approve can open a pull request and follow its checks ([`release.md`](release.md)).
- **Boundaries.**
  - Keys stay in the daemon, and each run calls it with a token of its own that reaches only its own task.
  - A default-deny egress proxy and a sandbox-exec or docker sandbox per run, both off by default.
  - Risk tiers on every change.
  - An auto-approve lane that is off and must be earned on a shadow record ([`sandbox.md`](sandbox.md)).
- **Work from where teams track it.** Issues from GitHub and Linear arrive triaged. Doc gardening and drift tasks run on a schedule.
- **Any harness, any model.**
  - Muse Code and the Stint agent by default.
  - Claude Code, Codex, and any Agent Client Protocol agent (goose, opencode, Gemini CLI) as off-by-default config entries.
  - A scoreboard that can route by results, and OpenTelemetry traces for any eval tool ([`otel.md`](otel.md)).
- **Stint builds Stint.** `scripts/loop.sh --self` turns the next spec into a Stint task that stops at your approval, and `stint report` writes the build record from `.stint/`.

## Limits you set

Each task has limits on what autopilot may use before it stops and asks you:

| Limit | Default | What counts |
|---|---|---|
| Builds | 8 | Agent runs that build the change. Work taken over from a best-of-n candidate counts on the candidate. |
| Hand-offs | 3 | Times another agent starts from a run's packet, whether autopilot, an escalation or a person handed it on. |
| Review rounds | 1 | Builds started because a review asked for changes. |
| Spend | no limit | Dollars spent on the task's runs and its other model calls: Sharpen, the packet digest, the pick, the learn step and the quiz. A model answer Stint had to throw away still counts, because it was paid for. |
| Agent time | no limit | Minutes from the start to the end of each run, a run still going included. |

The counts cover the task's whole life, so switching autopilot off and on does not reset them. Autopilot checks before each step. It starts no build or hand-off past the build limit, no hand-off past the hand-off limit, and no build a review asked for past the review round limit. Once the spend or agent time limit is reached, it starts nothing new. It also skips a build whose expected cost would pass the spend limit; the expected cost is the median of this task's earlier builds.

Set them under Limits in the New task form (Write it yourself, in the dialog n opens), with `stint new "<title>" --max-builds 4 --max-usd 3`, or as the defaults for new tasks in `.stint/config.json`:

```json
"limits": { "builds": 8, "handoffs": 3, "reviewRounds": 1, "usd": null, "minutes": null }
```

A task's own value wins over the default, and `null` means no limit. Builds go from 1 to 50, hand-offs from 0 to 20, review rounds from 0 to 10, spend from just above $0 to $1,000, and agent time from 1 to 1,440 minutes. A config with no `limits` keeps `autopilot.maxHops` as the hand-off limit, so an older config means what it did.

When a limit is reached, the daemon records `limit.reached` with the limit, what was used and the cap. It then stops autopilot with "Needs you" and a plain reason that quotes the same figures as the meter, such as "Needs you: the build limit is reached (8 of 8)." The task's status stays as it was, and the Board shows it in Needs you. The task view's title block shows a meter for builds, hand-offs and agent time, and for spend once the task has a spend limit; the one reached turns amber, with two ways on:

- **Raise the limit:** type the new limit in place. Stint records `limits.changed` and puts the task back on autopilot.
- **Hand to another agent:** opens the packet tab at its hand-to control. The stop clears once that run starts.

From a terminal, `stint limits <task>` prints every meter, review rounds included, and `stint limits <task> --max-builds 10` or `--none usd` changes them. Changing a limit this way does not restart autopilot; `stint run <task>` does. Both go through `PATCH /api/tasks/:id/limits`, and `GET /api/tasks/:id/limits` returns the limits and what the task has used. A merged, approved or abandoned task has no work left to limit, so its limits cannot change.

### A goal's limits

A goal can set a spend limit and a build limit for all of its tasks together. Before a build of a task with a goal, autopilot adds up the spend and the builds of every task in the goal and stops when the goal's limit is reached, or when one more build at the task's usual cost would pass its spend limit. It records `limit.reached` with `scope: "goal"` and the goal's id, and the stop names the goal: "Needs you: the goal's $5.00 spend limit is reached ($5.10 spent across G-0001's tasks)." The task view then sends you to the goal, where "Change the goal's limits" raises them (`PATCH /api/goals/:id/limits`, recorded as `limits.changed` with the goal's id). Each task made from a goal takes its share of the goal's spend and builds as its own limits, so a task usually stops at its own limit first; the goal's limit holds when you raise a task's own. The goal's own sharpen round and split are not counted against it.

## Stint as a tool for any agent

`stint mcp` serves Stint over MCP: the task list, packets, similar tasks, the decisions that constrain a file, recording a decision, handing off, autopilot and verify. The Stint plugin registers it for Muse Code, so Muse Code can read the memory mid-session. Any other MCP client can connect too. Approving and merging stay with a person. See [`mcp.md`](mcp.md).
