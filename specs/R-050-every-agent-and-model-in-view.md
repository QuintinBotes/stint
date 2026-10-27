# R-050 · Every configured agent and model in view

Day: added 27 Oct from the requirements audit · Owner: Q · Depends on: R-026, R-032, R-034 · Fallback: the status panel without the new host presets · Cut order: never

## Goal
A person sees every agent and model they could use, ready or not, and runs Claude Code or any harness on a local or gateway-served model by configuration alone (ADR-0001). The close of the demo says "any harness, any model, one packet"; this is where a viewer can check it.

## Context
ADR-0009 replaced the chip row with one status button (`apps/web/src/components/StatusMenu.tsx`), and `/api/health` gained `localModels` (`packages/daemon/src/hosts.ts`). Hosts are config entries (`packages/core/src/schemas/config.ts`, `DEFAULT_CONFIG`); the Claude Code preset passes `ANTHROPIC_BASE_URL` through from the shell only (`docs/agents.md`).

## Requirements
1. MUST show in the status panel: the daemon; ready agents; agents that cannot run with the reason; agents that are turned off with how to turn them on; each routed model with roles, hosts and readiness; chat models on a local host that no route names, with the command to use one; credits left. Escape and a click outside close it; it fits from 390 px wide.
2. MUST ship host entries, with no route pointing at them, for LM Studio (`http://localhost:1234/v1`), llama.cpp's server (`http://localhost:8080/v1`) and a LiteLLM gateway (`LITELLM_BASE_URL`, `LITELLM_API_KEY`), each `structuredOutput: 'prompt-only'` unless the host says otherwise.
3. MUST list local models from an OpenAI-compatible `/v1/models` when a keyless host has no Ollama `/api/tags`, leaving out embedding models.
4. MUST set `ANTHROPIC_BASE_URL` for a native Claude Code run from the base URL of the host its preset names (the host's address without a trailing `/v1`), unless the person's environment already sets it; a preset with no host passes the variable through as today.
5. SHOULD say in `docs/agents.md` how to run Claude Code, goose or opencode on LM Studio, llama.cpp or a LiteLLM gateway, with the same one-change pattern as Ollama.

## Interfaces
- `GET /api/health`: `localModels: Array<{ host, model, parameters: string | null }>`.
- Config: `hosts.lmstudio`, `hosts.llamacpp`, `hosts.litellm`.

## Acceptance
1. The top bar fits at 390, 1440 and 1600 px; the panel lists Muse Code, the agents you can turn on (Claude Code, Codex) and the routed models, and Escape returns focus to the button: `apps/web/e2e/shell.spec.ts`.
2. A keyless host answering `/api/tags` or `/v1/models` yields its unrouted chat models and no embedding model: `packages/daemon/test/hosts.test.ts`.
3. A Claude Code preset naming `host: ollama` gets `ANTHROPIC_BASE_URL=http://localhost:11434` in its run environment, and an explicit environment value wins: `packages/adapters/claude-code/test/env.test.ts`.
4. The default config validates with the three new hosts and no route names them: `packages/core/test/config.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh && bun run test:ui
```

## Out of scope
Discovering models on hosted providers; a UI for editing the config.

## Notes
Requirement 1 and Acceptance 1 landed in d5c1c95. LM Studio and llama.cpp both serve `GET /v1/models` in the OpenAI list shape (`{ data: [{ id }] }`).
