# Agents and models

Stint's defaults run Meta's models: Muse Code builds, the Stint agent continues on Muse Spark, plans come from Muse Wonder and reviews from Muse Glimmer on your machine. The demo uses nothing else. The packet is plain JSON and markdown, so any other agent or model can take a task too. Add it to `.stint/config.json`.

## Another coding agent

Any agent with a command line can take a task. It gets the same worktree, `prompt.md` with the packet, the daemon's own test run, and a packet when it ends. Agents live under `agents` in the config. Each entry is a manifest: the command to run, how the prompt reaches it, the roles it can take (`planner`, `implementer`, `reviewer`, `tester`, `learn`), the vendor, an optional model and host, and whether it is on. `host` must name a host in `hosts`, and every host in `routes` must be in `hosts` too. The daemon says so in plain words when it loads the config if one is missing.

`harness` picks the adapter. `cli` is the generic command line adapter. `claude-code` and `codex` are the native adapters described below. It defaults to `cli`.

Six presets ship turned off: `claude-code`, `codex`, `goose`, `opencode`, `gemini-cli` and `aider`. Set `enabled` to `true` and restart `stint up`. Then hand a task over with `stint hand T-0042 claude-code`. `/api/health` lists every configured agent, turned off ones as disabled, and the Hand to picker marks them the same way.

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

To run the Claude Code harness on Glimmer on your own machine, point it at Ollama's Anthropic-compatible endpoint. Ollama serves that endpoint on the same address as the rest of its API and takes any token:

```sh
export ANTHROPIC_BASE_URL=http://localhost:11434
export ANTHROPIC_AUTH_TOKEN=ollama
```

Then turn the preset on with the local model and host:

```json
"claude-code": { "command": ["claude", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"], "prompt": "stdin", "roles": ["implementer", "reviewer"], "vendor": "anthropic", "model": "muse-glimmer:30b-mlx", "enabled": true, "harness": "claude-code", "host": "ollama", "env": ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"] }
```

The two variable names in `env` are what let the daemon pass them into the run; the values stay in your environment and never enter the repo or a packet.

### Codex

The `codex` preset uses the native harness: `codex exec --json --sandbox workspace-write -`, with the prompt on stdin. Stint maps the thread start, agent messages, command runs, file changes, MCP tool calls and the turn usage onto the timeline, and resumes with `codex exec resume <thread id>`. The gate is observed.

To run Codex on a Meta model, give Codex an OpenAI-compatible provider in your Codex config (`~/.codex/config.toml`) that points at a host serving Muse Spark Open, such as Fireworks or Baseten, with that host's key variable as its `env_key`. Then turn the preset on and set its `model` to the model id that provider expects. Stint passes the model with `--model` and passes through only the variables named in `env`, such as `OPENAI_API_KEY`. Codex keeps its own provider and key settings; Stint only starts it in the worktree, watches it, and verifies after.

## Another model

The Stint agent and the plan and review client talk to any OpenAI-compatible host in `hosts`: the Meta Model API, Fireworks, Baseten, Modal, or Ollama on your machine. To run the Stint agent on another model, name the host and model, for example `stint hand T-0042 stint-agent --model fireworks/<model id>` or `--model ollama/qwen3-coder:30b`. To make it a fallback, put the same `host/model` entry in `routes.agent`, `routes.planner` or `routes.reviewer`. Add a price under `prices` to see what a run cost; without one the run shows as unpriced.

A model name Stint can't find is refused. Stint never swaps in another model without telling you.

## When agents fail

Autopilot hands a red or killed run to the next implementer in `autopilot.implementers`, with the packet the run left. Three settings change that:

- `escalateAfter` and `escalate`: after this many failed verifications (2 by default), the next hop goes to the first available entry of `escalate` instead, once. An entry is an agent id, or an agent and a model such as `stint-agent@meta-api/muse-spark-1.3`. The event `escalation.triggered` records who it went from and to, and how many runs failed.
- `bestOf`: build the task 2 or 3 times at once from the same plan. Each attempt is a child task (a candidate) with its own branch, built by the next implementer in the list. The daemon verifies each one. When more than one is green, the reviewer chain picks between their diffs; when no reviewer can answer, the smaller change wins. The task then takes over the picked branch, the daemon verifies it again, and it goes to review and your approval like any other task. The other candidates stay on their branches and are not merged.

```json
"autopilot": { "implementers": ["muse-code", "stint-agent"], "maxHops": 3, "parallel": 2, "escalateAfter": 2, "escalate": ["stint-agent@meta-api/muse-spark-1.3"], "bestOf": 2 }
```

## Nobody reviews their own work

Stint's reviewer skips any entry in `routes.reviewer` that runs the model the Stint agent built the change with, and tries the next one. The review run records what it skipped. When every entry is that model, the review is refused with `review_blocked` and the reason, so you can add a reviewer on another model. Another coding agent on the same model has its own harness and may be reviewed by it. Set `review.crossVendor` to `false` to turn this off.

## Which agent gets the task

The Factory's scoreboard shows how each agent and model has done, overall and per task tag:
- **Attempts:** runs the daemon verified.
- **Passed:** how many of those were green.
- **Last 3 all passed:** whether all of the last three attempts passed.
- **Cost per merged task**, and **reverts** after merge.

`GET /api/scoreboard` returns the same rows.

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

Each subtask still stops at your approval. The board shows the parent with its subtasks in order, and what each one waits for.

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
