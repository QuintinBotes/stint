# Changelog

## Unreleased

### Added (30 October)
- Live relays on three public repositories Stint had never seen (R-070): jshttp/negotiator, jeffbski/wait-on and vercel/ms. One task each goes from Muse Code to Claude Code on Muse Glimmer 30B to Codex on Muse Spark 1.3 by packet, is verified by the daemon with hidden tests, is reviewed offline, and stops at the gate. All three tasks reached the gate with the hidden tests green; a control task that cannot pass without editing a locked test stopped red before it; a seven-task learning sequence ran green with no findings, so no skill was proposed. Every run is published in `bench/relay/`, the failed ones too.
- The scorecard (R-070): `bun scripts/scorecard.ts` runs each relay task k times as a single run, has Glimmer review each green build, grades it with the hidden tests, and writes pass^k, hand-off success and how the review did against the hidden tests to `bench/scorecard.json`; `--render` prints the table in `docs/proofs.md`. Live, the Stint agent on Muse Spark Open passed 3 of 9.
- The learning chart on the Factory: review findings per task in the order reviewed, with a labelled mark where each skill was approved, drawn from the task and workspace logs so the replay draws it too.
- The judge page is published at https://quintinbotes.github.io/stint/, built on the owner's Mac with `bun run build:judge`.
- Run the goal's tasks asks first, as Run all does: what starts now and what waits, the goal's limits, and that nothing merges without you. Only Start starts it.

### Fixed (30 October)
- Agent CLIs on a Stint host run without the person's own setup: Claude Code with no MCP servers or subagents, and Codex from a clean home, so a run no longer carries the person's plugins. The person's own configs are never edited, and relay runs never publish raw agent transcripts.
- The Stint agent no longer reads a cut-off reply as done. A reply cut off before the model says or does anything is asked again with more room (4,096, then 16,384, then 32,768 output tokens), and a model still cut off at the most room ends the run failed, saying why. The first live scorecard found it.
- Approve writes the shadow decision before `merge.completed`, so whatever follows the merge already sees it.
- The enrich cost test waits for the packet as long as the daemon's own verification can take on a CI runner.

### Added (29 October)
- The spec builder (R-066): say what you want in a sentence, and Stint drafts a task or a goal in GitHub Spec Kit's shape, asks only the questions that change what gets built, and keeps the answers as decisions. It opens a Spec Kit `spec.md` and `tasks.md`, and writes a draft back as `spec.md`, with no model call. One dialog, "What do you want done?", opened by n, New task, New goal and the palette; `stint draft`; `/api/drafts`.
- Visual proofs (R-068): a criterion can name a page and what should be seen there. Once the tests are green, the daemon opens the page in headless Chromium, Muse Spark 1.3 judges the screenshot, SAM 3.1 marks what looks wrong, and the Tests tab shows what Stint saw. Sharpen offers It looks right as a proof. One live check of a seeded defect is kept in `bench/visual/`.
- The judge path (R-069): `bun run build:judge` builds a read-only copy of the finished replay for GitHub Pages, `bun run serve:judge` serves it locally, and a workflow publishes it once the owner turns `JUDGE_PAGES` on. The README opens with a section for judges.
- `stint mcp install claude` and `stint mcp install codex` register Stint's MCP server through each tool's own CLI; `--print` shows the command.
- Goals that run and finish (R-064): Run the goal's tasks on its page, `stint goal run`, `stint goal limits`, `stint goal abandon` and `POST /api/goals/:id/run`. A goal criterion with a proof reaches the tasks that cover it, and raising a goal limit resumes the tasks stopped at it.
- A command for every gate and board action: `stint changes` asks for changes, `stint list` prints every task, `stint run --all` starts every planned task (`--all --stop` takes every task off autopilot), `stint intake accept`, `merge` and `dismiss` settle intake items, and `stint proofs` works on a goal.
- A light theme that follows the system setting (R-067), on the same tokens as the dark one.
- `UX_AUDIT.md` (R-071): an adversarial audit of what needs you, what runs and what is safe to do next; 18 findings, 14 fixed with tests.

### Changed (29 October)
- The charcoal redesign (R-065): near-black surfaces, a compact top bar, a Board of four groups (Needs you, Planned, In progress, Closed) with its counts kept apart from decisions, cards with one label and one line, quiet tables, and a task page whose header gives the one next action. It replaces the navy Blueprint look.
- The Board says in a sentence what needs you and why. Run all says how many tasks it starts and asks first: which start now and which wait, the most builds any may use, how many have no spend limit, and that nothing merges without you. A task whose agent waits on a permission question is in Needs you, labelled with the tool.
- A task shows its goal and the tasks it waits for, on its card and in its header; the sign-off after a merge links to the goal and its next open task.
- Sending work back: reject and request changes start autopilot again when it stopped at the gate, so it builds from the ask, and otherwise set the task rejected, in Needs you. A request for changes runs the learn step too.
- Approve refuses with `decision_pending` while a review finding that would reverse a decision waits. The gate lists the finding and holds Approve with the reason, and `stint demo --live` keeps D3 before its approve beat.
- Bootstrap downloads Muse Glimmer 30B only with `--with-glimmer`.
- The replay turns on Claude Code (Muse Glimmer 30B through Ollama) and Codex (Muse Spark 1.3 on the Meta Model API) beside Muse Code and the Stint agent. A new repository still keeps them off.
- The status button says "Connected, 4 agents and 1 model ready", or "Replay, agents are off".
- The stop route answers once the run has finished; the verification and the packet follow on the task's stream.
- Every model call is metered, including the question to a leaving Muse Code session for its packet and the spec builder's drafts. An intake pull records `intake.received` and `intake.triaged` before anyone accepts the item.
- The Baseten host asks for `meta-models/muse-spark-open-1026`, the model the hackathon key accepts.

### Fixed (29 October)
- A board card no longer asks a model to summarise a task no agent has run, and the summary route answers `source: 'none'` for one.
- The gate says what was red (failed tests out of the total, held-out scenarios, tampered tests, or a check by name) instead of "0 failed".
- Held-out scenarios that cannot run turn the verification red.
- A command that cannot start, in the verifier or the Stint agent's shell, comes back red with the reason instead of ending the daemon.
- Two live runs no longer leave `.stint/active` naming the wrong one.
- A Board that fails to refresh keeps its last data under a stale warning, never "nothing needs you".
- Subtasks and best-of-n candidates keep their task's goal, its goal criteria and a share of its limits.

### Accessibility (29 October)
- Every status label draws a shape beside its word: a triangle needs you, a tick verified, a cross failed, a dot runs, a ring waits, a square is closed, a bar was abandoned, a diamond was learned.
- Red is deepened to `#f2786f`, which keeps it apart from green for people without red or green cones. The light theme is measured to the same contrast and colour-vision targets.
- axe finds no WCAG 2.2 A or AA violation on the main screens in either theme.
- Dialogs have a visible Close, keep focus inside and return it on close, and ask "Discard this draft?" before dropping what you typed. Every create or change sends one request however often it is pressed.
- Looking back in time says so in a notice and holds every action, key and palette command until Return to latest.

### Security (29 October)
- Under sandbox-exec a run can no longer write the rest of `~/.config`, `~/Library/Application Support` or `~/.bun/bin`, nor read the held-out scenarios or the files Stint loads keys from.
- The Stint agent's refusals read a command with its quotes and backslashes taken out, so a quoted branch name, a nested shell, a forced or detached checkout, a git alias and a quoted path outside the worktree that exists are refused.
- Inside a run, `stint mcp` lists only the 8 tools its run token can call, and the run token no longer reaches the hand and verify routes.
- A test pins the daemon to 127.0.0.1 and checks that another address of the machine is refused.
- A visual check puts nothing read from the page into the prompt, and calls SAM 3.1 with `store: false`.

### Added (28 October)
- Custom skills (R-060): write one, import one from a folder, a zip or git, read its pattern scan, approve it onto probation, and share it as a zip. The Skills page adds and previews them; `stint skills add`, `stint skills export`, `POST /api/skills/import`.
- Verification and outcome metrics, defined once (R-061): first pass, escaped defects, cost per good merge, human load and learning, each with its sample size. `stint metrics`, and the Factory's figures; the week's spend is one local Monday-to-Sunday figure.
- Limits you set on a task (R-062): builds, hand-offs, review rounds, spend and agent time, with config defaults, meters in the task view, and a stop that names the limit and offers Raise the limit or Hand to another agent. `stint new --max-*`, `stint limits`, `PATCH /api/tasks/:id/limits`.
- How it went (R-063): one outcome record per task, with each criterion proven, passing but not proven, failing or yours to check; loops against limits, spend, times, the review and what happened after the merge. On the gate and under a finished task's title; `stint outcome`, `GET /api/tasks/:id/outcome`.
- Sharpen (R-064): before work starts, the few questions whose answers change what gets built, each with a recommendation; questions the repository can answer are dropped in code, material ones are always asked, and answers become decisions every later run keeps. Proofs per criterion. `stint sharpen`, `stint answer`, `stint proofs`.
- Goals (R-064): an outcome above tasks with criteria and limits across its tasks; sharpen it, split it into tasks you check before any is created, and see how each part went. A Goals page, `stint goal`.
- Every model call's cost is counted: the diff digest, the autopilot's pick, board card summaries, intake triage, Sharpen and goal splits, and answers that came back invalid.

### Changed (28 October)
- A task's total spend includes its model calls that are not runs, so the header, the board card, the limit meter and How it went agree.
- A hand-off is an implementer run that starts from another run's packet, counted the same in the meters, How it went and the limits.
- A task autopilot stopped to ask you sits in the board's Needs you lane.
- The default replay is labelled "Replay, hand-written" on screen again (ADR-0011).
- fflate 0.8.3, which fixes a buffer over-read on Zip64 extra fields in skill bundles.

### Accessibility (28 October)
- Colours for colour-blind and low-vision people: the state inks (green verified, amber needs you, red stopped, violet learned) and the agent inks stay apart under protanopia, deuteranopia and tritanopia, every line of text meets 4.5:1 and small text 7:1 on the main surfaces, and the system's more-contrast setting brightens text and edges further.
- No meaning rests on colour alone: + and - mark added and removed lines in a diff, the memory graph draws decisions, findings and files as different shapes, the Factory's charts separate and name their parts, and Windows High Contrast keeps focus, chips, meters and selections visible.

### Security and robustness (28 October)
- Each run gets its own token that reaches only its task's agent routes; the macOS sandbox denies reads of `.stint/cache` and writes to `.git/hooks` and `.git/config`; the daemon's git runs with hooks off; verify runs inside the run's sandbox.
- A run cut off by a crash or `stint down` is closed as killed on the next start; a torn line no longer breaks an event log; two tasks can no longer get the same id.
- Approve merges only a verified commit, and only the latest verification's tamper result stands.
- Lines typed in the terminal and tool output are scrubbed of secrets before they reach the event log; test output is capped; event logs are cached; the Stint agent's search runs off the daemon's thread with a 5 second cap.

### Added
- Specs R-050 to R-057 and eleven architecture decision records (`docs/adr/`), from a requirements audit of R-001 to R-049 on 27 October.
- A README and a setup guide a stranger can follow (R-059): keys saved once in a user-level file (`stint keys set`, `stint keys list`), `stint doctor` with the command that fixes each failing check, `scripts/install-cli.sh` for the `stint` command, and a bootstrap that replays the story with no keys.
- A guard that keeps client and employer names out of the repository, in CI (R-058).
- One status button for the daemon, agents and models, with the chat models on this machine that no route uses yet; LM Studio, llama.cpp and LiteLLM as hosts; Claude Code takes its base URL from its host.
- The diff tab on @pierre/diffs with a file tree, viewed marks, per-hunk attribution from git blame and line comments the next agent receives; a windowed timeline with checkpoints that restore a run's code.
- Cards with every state, the review's blockers, the full sign-off record, a permission tier per run and plan steps marked from the packet; the Factory's workspace graph, 7-day funnel, transcript-share figure, benchmark bars and credits left.
- The first live golden eval: 9 of 9 tries passed.
- `bun run dev` is a watch loop for the daemon and the UI; `bun run demo` is the replay.

### Changed
- The Stint agent's refusals check every part of a chain, see through git's global options, and refuse paths outside the worktree and links that lead out of it; grep skips credential files and links.
- Every write under `.stint/` is atomic; `stint otel export` writes beside you.
- Live commands hold off idle sleep on macOS, and the verifier's cap counts awake time only.

### Fixed
- The live golden eval checked its pinned commit out detached, which the daemon refuses.
- Toggles that never showed their state; `[` and `]` losing the file list while events arrived; a replaced terminal dropped from the registry.

## 0.1.0, Meta Global AI Developer Hackathon (26 October to 4 November 2026)

The first release. Everything here was built during the event; `PROGRESS.md` records each spec, who built it and how it was verified.

### The task outlives the agent
- **Workspace:** tasks are folders in `.stint/`. Each has a hash-chained event log, and the daemon is its only writer.
- **Isolated runs:** every run gets its own git worktree, and the daemon runs the tests itself afterwards.
- **The packet:** whenever a run ends, the daemon writes a packet of at most 600 tokens. A killed run gets one too, built from the log alone.
- **Two coding agents on Muse Spark 1.3:** Muse Code, and Stint's own agent with refusals Stint enforces. Hand a task from one to the other at any point.
- **Autopilot:** it plans, builds, verifies and reviews until the approval gate. It hands off when a run fails, stops when two agents in a row make no progress, and can write failing acceptance tests first.
- **Approve:** a real merge with Stint-Task trailers. Reject turns the reason into a decision and the next ask.


### The factory (added on 26 October from the factory review)
- **Verification the agent cannot fake:** the daemon runs a suite of checks. The test files a task names are locked at plan time, and an unexplained change to one fails the run. Held-out scenarios run in a checkout the agent never sees.
- **After merge:** the daemon watches reverts, follow-up work, CI on the base branch and incidents, and links each one to the task that caused it. Approve can open a pull request and follow its checks.
- **Learning that is measured:** a skill starts on probation and earns its place on tasks it helped. A skill that hurts is proposed for retirement. Golden tasks report pass@1 and pass^3.
- **Any agent, any model:** an agent is a config entry. Claude Code and Codex have native adapters, and the Agent Client Protocol adapter covers goose, opencode and Gemini CLI. Every permission request lands in Stint's queue. All are off by default.
- **Smarter hand-offs:**
  - A task escalates after repeated failures.
  - Best of n builds candidates and keeps the best green one.
  - No model reviews its own work.
  - Reviews run per lens: general, security and spec fit.
- **Work from where teams track it:** issues from GitHub and Linear arrive triaged, with size, risk and possible duplicates, and become tasks only when you accept them. Upkeep tasks (doc gardening, dead code and drift) run on a schedule.
- **Plans that remember:** the planner reads similar tasks and the decisions on the files it will touch. It splits big tasks into subtasks that run in dependency order.
- **Risk and the auto-approve lane:** every change gets a risk tier with its reasons. The policy's would-approve is recorded beside every human decision. A lane that merges low-risk changes by policy must be earned on that record, and is off unless you turn it on.
- **Boundaries:** keys stay in the daemon. A default-deny egress proxy, and a sandbox-exec or docker sandbox, run each agent.
- **Seeing the work:**
  - A Files tab with "Open in your editor".
  - A scoreboard per agent and model, with routing learned from it.
  - OpenTelemetry traces.
  - `stint report` for the build record, and `loop.sh --self` so Stint builds Stint.
### Meta models
- **Planning:** Muse Wonder 1.0.
- **Building and continuing:** Muse Spark 1.3.
- **Offline review:** Muse Glimmer 30B through Ollama.
- **Fallback hosts:** Muse Spark Open on Fireworks, Baseten and Modal.
- **Factory view:** shows which model did what, where it ran, and what it cost.

### Memory and learning
- **Memory graph:** projected from the logs, with time travel, similar tasks, files that change together, and the decisions that constrain a task.
- **Decisions are protected:** a review finding that would reverse a decision waits for a person.
- **Learning:** a finding that recurs across tasks becomes a skill proposal with evidence, written only when a person approves it.

### Measuring the packet
- **`stint bench`:** transcript against packet on five live tasks, with the results and charts in the repository.
- **The packet quiz:** facts from the full record, answered from the packet alone.
- **A diff digest** for runs that cannot be asked.
- **Packet sources:** where each part of a packet came from.

### Open to other agents
- Any command-line agent can be added in config (Claude Code and Codex presets ship turned off).
- The Stint agent can run any configured `host/model`.
