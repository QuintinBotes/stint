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
