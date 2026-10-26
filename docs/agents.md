# Agents and models

Stint's defaults run Meta's models: Muse Code builds, the Stint agent continues on Muse Spark, plans come from Muse Wonder and reviews from Muse Glimmer on your machine. The demo uses nothing else. The packet is plain JSON and markdown, so any other agent or model can take a task too. Add it to `.stint/config.json`.

## Another coding agent

Any agent with a command line can take a task. It gets the same worktree, `prompt.md` with the packet, the daemon's own test run, and a packet when it ends. Two presets ship turned off:

```json
"agents": {
  "claude-code": { "command": ["claude", "-p", "--permission-mode", "acceptEdits"], "prompt": "stdin", "roles": ["implementer", "reviewer"], "vendor": "anthropic", "enabled": false },
  "codex": { "command": ["codex", "exec", "--full-auto", "-"], "prompt": "stdin", "roles": ["implementer", "reviewer"], "vendor": "openai", "enabled": false }
}
```

Set `enabled` to `true` and restart `stint up`. Then hand a task over with `stint hand T-0042 claude-code`. `prompt` can be `stdin`, `file` (the path of `prompt.md`) or `arg`. `{prompt}` and `{model}` in `command` are replaced. Stint can't see these agents' token usage, so their runs show as unpriced, not as $0. Stint can't check their tool calls either, so the gate reads "observed".

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
