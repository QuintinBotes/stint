# R-032 · An open registry of agents, hosts and roles

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-026

## Goal
Any agent, any model, by configuration. Adding Codex, Gemini CLI, goose or a local LM Studio model must be a config entry, not a schema change.

## Requirements
1. MUST validate adapter ids, host ids and roles against `.stint/config.json` instead of closed enums: every `run.started.adapter` must be a registered adapter, every host a configured host; `tester` and `learn` are roles alongside planner, implementer and reviewer.
2. MUST extend the `agents` config (R-026) into manifests: `{command, prompt, roles, vendor, model?, enabled, harness?, host?, events?: {format: 'jsonl', type: <path>, text: <path>, tool: <path>, args: <path>, usage: {input, output, cached}}, resume?: {flag}, permissions?: {flags}, capabilities?: {resume, schemaOutput, sandbox, costReporting}}`; a manifest with `events` maps each JSON line of the agent's output to `agent.message`, `agent.tool_call`, `agent.tool_result` and usage, so its runs are priced.
3. MUST list every configured agent in `/api/health` with harness, host, model, roles and capability flags, and in the UI's Hand to picker.
4. MUST ship disabled manifests for goose, opencode, Gemini CLI and Aider beside the Claude Code and Codex presets.

## Acceptance
1. A manifest agent emitting JSONL produces mapped tool calls and a priced run: `packages/adapters/cli-agent/test/manifest.test.ts`.
2. Assigning an adapter id not in the registry is refused with `adapter_unavailable` naming the configured ids: `packages/daemon/test/registry.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
