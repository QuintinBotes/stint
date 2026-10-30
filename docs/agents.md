# Agents and models

This page is for anyone who wants Stint to run another coding agent or model, or to change how autopilot picks, escalates, reviews and plans. Stint's defaults run only Meta's models: Muse Code and the Stint agent build on Muse Spark 1.3, Muse Wonder plans, and Muse Glimmer 30B reviews on your machine. The demo's replay also turns on Claude Code, on Muse Glimmer 30B through Ollama, and Codex, on Muse Spark 1.3 through the Meta Model API, so its status menu lists four agents on Meta's models alone; a new repository keeps them off. The packet is plain JSON and markdown, so any other agent or model can take a task too. Every setting below lives in `.stint/config.json`.

## Another coding agent

Any agent with a command line can take a task. It gets the same worktree, `prompt.md` with the packet, the daemon's own test run, and a packet when it ends. Its hooks and `stint mcp` reach the daemon through `STINT_DAEMON_PORT` with `STINT_RUN_TOKEN`, a token for this run only: it works on its own task's agent routes while the run lasts, and approving or merging is refused with it ([`sandbox.md`](sandbox.md#a-sandbox-per-run)). Agents live under `agents` in the config. Each entry is a manifest: the command to run, how the prompt reaches it, the roles it can take (`planner`, `implementer`, `reviewer`, `tester`, `learn`), the vendor, an optional model and host, and whether it is on. `host` must name a host in `hosts`, and every host in `routes` must be in `hosts` too. The daemon says so in plain words when it loads the config if one is missing.

`harness` picks the adapter. `cli` is the generic command line adapter. `claude-code` and `codex` are the native adapters described below. `acp` is the Agent Client Protocol adapter described below; `acp: true` in a manifest means the same thing. `harness` defaults to `cli`.

Seven presets ship turned off: `claude-code`, `codex`, `goose`, `opencode`, `gemini-acp`, `gemini-cli` and `aider`. Set `enabled` to `true` and restart `stint up`. Then hand a task over with `stint hand T-0042 claude-code`. `/api/health` lists every configured agent, turned off ones as disabled, and the Hand to picker marks them the same way.

No preset carries a flag that bypasses approvals or turns off a sandbox. Some agents ask before they act unless such a flag is given, so the presets use the safest flags that still run without a person at the keyboard. You choose any further permission flags for your own machine, in `command` or in `permissions.flags`, which Stint adds to the command line.

`prompt` can be `stdin`, `file` (the path of `prompt.md`) or `arg`. `{prompt}` and `{model}` in `command` are replaced. `env` names the credential variables the agent needs; every other key stays in the daemon. `resume.flag` is the flag the generic adapter adds with the session id to continue a run, and `capabilities` says plainly whether the agent can resume, produce structured output, run in a sandbox, and report its cost.

### Seeing what a generic agent did

A plain command line agent prints text, and each line becomes a message on the timeline. If the agent prints JSON, one object per line, an `events` block turns those lines into tool calls, tool results, messages and usage:

```json
"my-agent": {
  "command": ["my-agent", "--json"],
  "prompt": "stdin",
  "roles": ["implementer"],
  "vendor": "other",
  "model": "my-model",
  "enabled": true,
  "harness": "cli",
  "events": {
    "format": "jsonl",
    "type": "kind",
    "text": "text",
    "tool": "tool",
    "args": "args",
    "callId": "id",
    "result": "output",
    "session": "session_id",
    "usage": { "input": "usage.input", "output": "usage.output", "cached": "usage.cached" },
    "kinds": { "message": ["message"], "tool_call": ["tool_call"], "tool_result": ["tool_result"], "usage": ["usage"] }
  }
}
```

The paths are dotted paths into each line, such as `usage.input`. `kinds` names the values of the `type` field. A line whose type matches no kind is kept on the timeline as unclassified, never dropped. When usage is reported, the daemon prices the run from `prices` under the key `<agent>/<model>`, for example `my-agent/my-model`. Without usage the run shows as unpriced, not as $0. Stint cannot check these agents' tool calls before they run, so the gate reads "observed": it watches what happens and verifies after.

Handing a task to an id that is not registered is refused, and the message lists the configured adapters so you can pick one that exists.

### Claude Code

The `claude-code` preset uses the native harness: `claude -p --output-format stream-json --verbose --permission-mode acceptEdits`, with the prompt on stdin and `--model` taken from the manifest's `model`. Stint maps the session start, assistant text, tool use, tool results and the final result (usage, cost and session id) onto the timeline, and resumes with `--resume <session>`. The gate is observed.

Approvals stay on: the run may edit files, and the one shell command it may run without asking is the task's own test command (`--allowedTools "Bash(<test command>:*)"`), so it can check its work before the daemon verifies it. Any other command still asks, and nothing bypasses permissions.

With your Anthropic key in the key file (`stint keys set ANTHROPIC_API_KEY`), runs bill your API account rather than a Claude subscription. An organisation key that is not scoped to a workspace is refused with "must include the anthropic-workspace-id header": either create the key inside a workspace in the Anthropic Console, or add `ANTHROPIC_CUSTOM_HEADERS=anthropic-workspace-id: <workspace id>` to the key file, which the preset passes through.

To run the Claude Code harness on Glimmer on your own machine, name a host in the preset. Ollama serves an Anthropic-compatible endpoint on the same address as the rest of its API, so Stint gives the run `ANTHROPIC_BASE_URL` from the host's address (without its `/v1`) and, for a host that needs no key, a placeholder `ANTHROPIC_AUTH_TOKEN`:

```json
"claude-code": { "command": ["claude", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"], "prompt": "stdin", "roles": ["implementer", "reviewer"], "vendor": "anthropic", "model": "muse-glimmer:30b-mlx", "enabled": true, "harness": "claude-code", "host": "ollama" }
```

A value you set yourself wins: list `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` in the preset's `env` and export it, and the run uses yours. A host that needs a key, such as a LiteLLM gateway, gets the address but never a token from Stint; pass the token through `env` the same way. Values stay in your environment and never enter the repo or a packet.

### Other places a model can run

Three more hosts ship in the default config with no route pointing at them, so they cost nothing until something names them:

| Host | Address | Key |
|---|---|---|
| `lmstudio` | `http://localhost:1234/v1` | none |
| `llamacpp` | `http://localhost:8080/v1` (llama.cpp's `llama-server`) | none |
| `litellm` | `LITELLM_BASE_URL` | `LITELLM_API_KEY` |

Name one in a route (`"reviewer": ["lmstudio/<model id>", ...]`), in a hand-off (`stint hand T-0042 stint-agent --model llamacpp/<model id>`), or as the `host` of a harness preset. The status panel lists the chat models each local host has loaded that no route uses yet, with the command to try one. Small local models call tools less reliably than hosted ones, so start them on review and summary before giving them the implementer role.

### Codex

The `codex` preset uses the native harness: `codex exec --json --sandbox workspace-write -`, with the prompt on stdin. Stint maps the thread start, agent messages, command runs, file changes, MCP tool calls and the turn usage onto the timeline, and resumes with `codex exec resume <thread id>`. The gate is observed.

To run Codex on a Meta model, set the Codex agent's `host` to a Stint host such as `meta-api`: Stint then points Codex at that host for each run with `-c` overrides on Codex's command line (`codexArgs` in `packages/adapters/codex`), and your own Codex config is left alone. Without a `host`, Codex uses the provider in your Codex config (`~/.codex/config.toml`), as below. Codex speaks only the Responses API (`wire_api = "chat"` is refused), and the Meta Model API serves it. This one ran on 27 October 2026 with Codex 0.163 and Muse Spark 1.3; its stream is the Codex mapper's test fixture:

```toml
model_provider = "meta"

[model_providers.meta]
name = "Meta Model API"
base_url = "https://api.meta.ai/v1"
env_key = "META_API_KEY"
wire_api = "responses"
```

Then turn the preset on, set its `model` to `muse-spark-1.3`, and add `META_API_KEY` to its `env`: Stint passes through only the variables named there. Codex warns that it has no metadata for the model and carries on; Stint keeps the warning on the timeline as unclassified. A host that serves Muse Spark Open, such as Fireworks or Baseten, works the same way if it serves `/v1/responses`; those two are not verified yet. Ollama does serve it, which is what `codex exec --oss` uses for Glimmer. Codex keeps its own provider and key settings; Stint only starts it in the worktree, watches it, and verifies after.

### Agent Client Protocol (ACP)

The Agent Client Protocol is JSON-RPC 2.0 over stdio, one JSON object per line, spoken by goose, opencode, Gemini CLI and others: https://agentclientprotocol.com. With `harness: "acp"`, Stint is the client. It starts the command in the manifest, opens a session in the run's worktree, and sends `prompt.md` as the prompt; the manifest's `prompt` setting is ignored for ACP. Messages, tool calls and tool results from the agent land on the same timeline as every other run. ACP does not report token usage, so these runs show as unpriced, not as $0.

Because Stint is the client, the agent's file reads and writes, terminal commands and permission questions come to Stint first. File paths must resolve inside the worktree, symlinks included; a path outside is refused and recorded. Terminal commands run in the worktree in the run's sandbox. A permission question waits for you: it appears on the task, puts the task in the Board's Needs you labelled with the tool, and sits in the queue on the Factory (`/factory`) with the choices the agent offered (such as allow once, always for this run, or reject), and your answer goes back to the agent. `GET /api/permissions` lists the questions still waiting. Stopping a run cancels any question it is waiting on.

Three presets use ACP, all turned off: `goose` (`goose acp`, https://block.github.io/goose/docs/guides/acp-clients), `opencode` (`opencode acp`, https://opencode.ai/docs/acp/) and `gemini-acp` (`gemini --experimental-acp`, https://geminicli.com/docs/cli/acp-mode/). No preset carries a flag that bypasses approvals.

To run goose on a Meta model, configure goose with an OpenAI-compatible provider pointed at the Meta Model API: set the provider's base URL to `https://api.meta.ai/v1`, give it your `META_API_KEY` in goose's own settings, and pick a Muse model such as `muse-spark-1.3`. Then turn the `goose` preset on.

To run opencode on a Meta model, add an OpenAI-compatible provider in your opencode config with the same base URL, `https://api.meta.ai/v1`, your `META_API_KEY`, and a Muse model. Then turn the `opencode` preset on.

To run either one offline, point that same OpenAI-compatible provider at Ollama on your machine instead: base URL `http://localhost:11434/v1`, model `muse-glimmer:30b-mlx`, and no key. goose and opencode both accept a custom OpenAI-compatible endpoint, so the only change is the address and the model name. The keys stay in each tool's own settings and your environment; Stint passes through only the variables named in `env`.

## Another model

The Stint agent and the plan and review client talk to any OpenAI-compatible host in `hosts`: the Meta Model API, Fireworks, Baseten, Modal, or Ollama on your machine. To run the Stint agent on another model, name the host and model, for example `stint hand T-0042 stint-agent --model fireworks/<model id>` or `--model ollama/muse-glimmer:30b-mlx`. To make it a fallback, put the same `host/model` entry in `routes.agent`, `routes.planner` or `routes.reviewer`. Add a price under `prices` to see what a run cost; without one the run shows as unpriced.

A model name Stint can't find is refused. Stint never swaps in another model without telling you.

## When agents fail

Autopilot hands a red or killed run to the next implementer in `autopilot.implementers`, with the packet the run left. It stops and asks you once the task reaches one of its limits: 8 builds, 3 hand-offs and 1 review round by default, set per task or in `limits` in the config ([`factory.md`](factory.md#limits-you-set)), with optional limits on spend and agent time. A task made from a goal also stops at the goal's spend and build limits, counted across all of the goal's tasks. A hand-off is any build that starts from a packet, whether autopilot, an escalation or you handed it on. A config with no `limits` keeps `autopilot.maxHops` as the hand-off limit. Three settings change who gets the next hop:

- `escalateAfter` and `escalate`: after this many failed verifications (2 by default), the next hop goes to the first available entry of `escalate` instead, once. An entry is an agent id, or an agent and a model such as `stint-agent@meta-api/muse-spark-1.3`. The event `escalation.triggered` records who it went from and to, and how many runs failed.
- `bestOf`: build the task 2 or 3 times at once from the same plan. Each attempt is a child task (a candidate) with its own branch, built by the next implementer in the list. The daemon verifies each one. When more than one is green, the reviewer chain picks between their diffs; when no reviewer can answer, the smaller change wins. The task then takes over the picked branch, the daemon verifies it again, and it goes to review and your approval like any other task. The other candidates stay on their branches and are not merged.

```json
"autopilot": { "implementers": ["muse-code", "stint-agent"], "maxHops": 3, "parallel": 2, "escalateAfter": 2, "escalate": ["stint-agent@meta-api/muse-spark-1.3"], "bestOf": 2 }
```

## Nobody reviews their own work

Stint's reviewer skips any entry in `routes.reviewer` that runs the model the Stint agent built the change with, and tries the next one. The review run records what it skipped. When every entry is that model, the review is refused with `review_blocked` and the reason, so you can add a reviewer on another model. Another coding agent on the same model has its own harness and may be reviewed by it. Set `review.crossVendor` to `false` to turn this off.

## Which agent gets the task

The Agents table on the Factory shows how each agent and model has done, overall and per task tag:
- **Runs tested:** runs the daemon verified.
- **Passed:** how many of those were green.
- **Passed the last 3:** whether all of the last three passed.
- **Reverted:** the merges reverted later.

`GET /api/scoreboard` returns the same rows, with the cost per merged task as well.

By default autopilot picks agents in the order of `autopilot.implementers`. With `"routing": { "mode": "learned", "explore": 0.1 }` it picks from the results instead.
- For each available agent, it draws once from that agent's record on tasks with the same tags. Agents with more passes draw higher more often, and the highest draw wins.
- In a tenth of picks it gives the task to the least-tried agent instead, so a new agent still gets work.
- Results recorded by evals (`eval.ran`) count as attempts, so routing can start from what an eval measured.
- A hand-off never goes back to the agent that just failed.
- Each pick is recorded as `routing.chosen`, with the records it was based on.

## One set of instructions for every agent

`AGENTS.md` and `.agents/skills` are the only source. When you enable an agent that reads its own file, `stint init` links that file to `AGENTS.md`: `CLAUDE.md` for Claude Code, `GEMINI.md` for Gemini CLI. Where symlinks don't work it copies the file instead, and it never overwrites a file you already have. With Claude Code enabled, an approved skill is also written to `.claude/skills/<id>/SKILL.md` in the same commit, and removed again when the skill is retired. With only Meta's agents enabled, none of these files appear.

## Big tasks split into parts

The planner sees what the factory remembers before it plans:
- the three tasks most like this one, and why they match;
- every decision and open finding on the files the task names, or on files its similar tasks touched.

The plan records which similar tasks it used and the constraints it was given. A plan that would reverse a decision has to say so as a decision of its own.

When a task is too big for one run, the plan can split it into up to six subtasks, each with its own goal and acceptance, and say which ones must be merged first. Stint creates them as tasks under the parent. Autopilot then:
- runs the ones with nothing to wait for, up to `autopilot.parallel` at a time;
- holds back the others until what they need is merged;
- finishes the parent once every subtask is merged.

Each subtask still stops at your approval. The Board (`/`) shows the parent with its subtasks in order, and what each one waits for.

## Reviews with different jobs

By default one reviewer reads each change. To give reviews separate jobs, set `review`:

```json
"review": { "lenses": ["general", "security", "spec-fit"], "bestOf": 2, "crossVendor": true }
```

- **general:** the normal review.
- **security:** looks only for injection, secrets, missing access checks, unsafe input handling and network or file access the task doesn't need. It blocks on anything exploitable.
- **spec-fit:** checks each acceptance criterion and adds a finding for every one the change misses.

With `bestOf` above 1, the general review is asked of reviewers on different hosts in `routes.reviewer`. When two of them find the same thing (same file and line, or the same subject), it is shown once with how many found it. If they disagree on the verdict, the review says so.

When more than one review ran, the gate reads a combined review: any block blocks, and any request for changes sends it back. The review tab shows each review with its verdict and model.

## Upkeep on a schedule

Agent-written code drifts, so the factory can look after itself through the same queue as everything else:

```json
"gardening": { "schedule": "weekly", "tasks": [{ "title": "Prune stale feature flags", "goal": "Remove flags that have been on for every tenant for a month." }] }
```

On the schedule (daily or weekly), Stint makes one task per job and puts it on autopilot, which stops at your approval as usual. Two jobs come built in:
- **Doc gardening:** README, AGENTS.md and docs/ against the code, for stale commands, dead links and flags that no longer exist.
- **Dead code and dependency drift:** removes what is clearly dead, and proposes upgrades rather than making them.

A job with a task still open is skipped until that task is merged or abandoned. The Factory shows each job and when it is next due.

## Work from GitHub and Linear

```bash
stint intake github --label stint    # through gh, for the repository here or --gh-repo owner/name
stint intake linear --team ENG       # the Linear key comes from the variable intake.linear.keyEnv names
```

Each open issue becomes an intake item on the Board, never a task straight away. Stint triages it on the planner chain:
- a size: S for one run, M for a few, L for work that must be split;
- a proposed title, goal and acceptance criteria;
- the existing tasks it may duplicate, chosen only from tasks with matching words;
- a risk tier and one line on why.

You accept it as a task (it keeps a link to the issue), merge it into the task it duplicates, or dismiss it, on the Board or from a terminal:

```bash
stint intake accept github-41                # from its triage, or with --title, --goal and --accept
stint intake merge github-41 --into T-0042
stint intake dismiss github-41 --reason "duplicate of an old bug"
```

Each new item records `intake.received` and `intake.triaged` (or the triage's failure, with the reason) on the workspace log before anyone accepts it, and accepting copies both to the task. Nothing is ever pulled twice. With `intake` set in the config, the daemon also pulls every 15 minutes.
