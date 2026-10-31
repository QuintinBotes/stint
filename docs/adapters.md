# Adapters

This page explains how Stint drives a coding agent, how to add one, and what Stint can prove about the agents it drives.

An adapter is how Stint drives one coding agent. It never touches `.stint/`: it reports what happens, and the daemon writes everything to the log, so every agent's work looks the same on the timeline and in the packet.

## The contract

The contract is in `packages/core/src/adapter.ts`:

| Member | What it does |
|---|---|
| `id`, `vendor`, `roles` | Names the agent, whose model it is, and which roles it can take (`planner`, `implementer`, `reviewer`, `tester`, `learn`) |
| `capabilities` | What it can do: edit files, run commands, resume a session, return structured output, work offline |
| `available()` | Whether it can run now and, when it cannot, the reason in plain words (for example, "muse is not on PATH") |
| `gate()` | How strongly Stint controls its tool calls: `enforced`, `observed` or `none` (see below) |
| `run(ctx)` | Runs one leg in the worktree, with the prompt, budget and abort signal the daemon gives it. It reports events through `ctx.emit` and returns how it ended, its cost, and the step in flight if it was killed. |
| `resume?`, `enrich?` | Optional: continue a live session, or ask the leaving agent to improve its packet before the session closes |

The daemon does the rest:

- the worktree, the run's environment and the prompt (with the packet, plan, skills and diff);
- snapshots of changed files, and the work-in-progress commit;
- the test run, the packet and the price.

So an adapter is small: about 100 lines for a command line agent.

## Honest gates

A gate claims only what Stint actually controls:

- **`enforced`** means Stint decides every tool call before it runs, and has refused one in this daemon's lifetime. The Stint agent reports `enforced` only once its refusal set has fired.
- **`observed`** means the agent runs its own tools under its own safeguards, and Stint watches the stream and verifies afterwards. Muse Code and any command line agent are `observed`. Stint never turns off an agent's own approvals or sandbox.
- **`none`** is for adapters that run no tools (the replay).

The UI shows the gate beside each agent, and the packet attributes every refusal to whoever refused it.

## The adapters that ship

| Adapter | Agent | Model | Gate |
|---|---|---|---|
| `muse-code` | Muse Code (`muse exec --json`) | Muse Spark 1.3 or Muse Wonder | observed |
| `stint-agent` | Stint's own tool-calling loop | Muse Spark 1.3 on the Meta Model API by default; any `host/model` in config | enforced once a refusal fires |
| `replay` | None: plays a recording | none | none |
| `claude-code`, `codex` | Claude Code and Codex through their own JSON streams, off by default | The model each is configured with | observed |
| `acp` | Any Agent Client Protocol agent, such as goose, opencode or Gemini CLI, off by default | Its own | observed |
| `cli` | Any other command line agent under `agents` in config, off by default | Its own | observed |

Some model calls are not adapters: planning, review, the spec builder's drafts, Sharpen's questions, a goal's split into tasks, the learn step, the packet digest and the quiz. The daemon makes these calls through a chain of OpenAI-compatible hosts: the Meta Model API, Fireworks, Baseten, Modal, and Ollama on your machine. A visual check is not an adapter either: the daemon calls Muse Spark 1.3 and SAM 3.1 on the Meta Model API directly ([`verify.md`](verify.md#what-stint-saw-visual-checks)). A busy host, or one that twice answers with output that does not fit the schema the call asked for, falls through to the next one, and the fallback appears on the timeline. The cost of every call is counted, including an answer that was thrown away ([`metrics.md`](metrics.md#spend)).

## Adding one

For an agent with a command line, add an entry under `agents` in `.stint/config.json` ([`agents.md`](agents.md)); no code is needed. For an agent with an event stream worth mapping (tool calls, usage, a session to resume), write an adapter like `packages/adapters/muse-code/`:

1. **Map its stream.** Its events become `agent.message`, `agent.tool_call` and `agent.tool_result`, and its usage becomes the cost.
2. **Kill it properly.** Kill its process group on `ctx.signal`, and return `endedBy: 'killed'` with the open tool call as `inFlight`.
3. **Register it.** Add it in `defaultAdapters()` in `packages/daemon/src/server.ts`.
4. **Test it.** Use a recorded stream as a fixture, the way `packages/adapters/muse-code/test/` does.
