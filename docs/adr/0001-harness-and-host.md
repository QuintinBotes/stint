# ADR-0001: Harness and host are configured separately; Meta models by default, every other agent and model opt in

Status: Accepted, 27 October 2026. Builds on D-018, D-019 and D-034. Specs: R-026, R-032, R-033, R-034, R-050.

## Context
The hackathon rule (D-018) is that the runtime models are Meta's. Someone building with Stint after the hackathon wants Muse, Claude, Codex, a local model or whatever they prefer. Treating each product as one adapter makes every new agent a schema change. The factory review (26 Oct) split the idea of an agent in two: the harness that runs the loop (Muse Code, the Stint agent, Claude Code, Codex, goose, opencode, Gemini CLI, aider) and the host that serves the model (the Meta Model API, Fireworks, Baseten, Modal, Ollama, LM Studio, llama.cpp, a LiteLLM gateway).

## Decision
- Agents and hosts are open ids in `.stint/config.json`, validated against the config, not closed enums. An agent names its harness, host, model, roles and capability flags.
- Three adapter tiers sit behind the one adapter contract: native (Muse Code, Claude Code, Codex), ACP (any Agent Client Protocol agent), and a manifest for anything with a headless JSONL mode.
- The defaults and the demo run only Meta models: Muse Code and the Stint agent on Muse Spark, Muse Wonder for plans, Muse Glimmer for local review. Every other agent ships as a preset that is turned off, and every other host as an entry no route points at.
- Local OpenAI-compatible servers (Ollama, LM Studio, llama.cpp) and a LiteLLM gateway are hosts like any other. A harness that speaks Anthropic's `/v1/messages` (Claude Code) takes its base URL from the host its preset names, so pointing it at a local model is a config change.
- The status panel lists what is configured and what is on this machine, so a person sees the choices without reading the config.

## Consequences
- Adding an agent or a model is configuration, and a hand-off between any two is the same packet.
- The demo's claim "any harness, any model, one packet" holds while every model in it is Meta's.
- Tool calling on small local models is unreliable, so local models are routed to review and summary before implementer roles, and the validate-and-retry path stays on for every host.
