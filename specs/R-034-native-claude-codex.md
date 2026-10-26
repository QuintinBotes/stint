# R-034 · Native Claude Code and Codex adapters

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-032

## Goal
Full-fidelity adapters for the two agents people already use, off by default, so a person can bring them; under the hackathon rule they run on Meta models only (Claude Code's harness on local Glimmer through Ollama's Anthropic-compatible endpoint).

## Requirements
1. MUST implement `packages/adapters/claude-code`: `claude -p --output-format stream-json --verbose` with the prompt on stdin, mapping `assistant` text, `tool_use` and `tool_result` blocks and the final `result` (usage, cost, session id) to Stint events; resume with `--resume <session>`; `ANTHROPIC_BASE_URL` and model from config so it can run on Ollama.
2. MUST implement `packages/adapters/codex`: `codex exec --json` mapping its JSONL events (thread, turn, item started/completed, agent message, command execution, file change, usage) to Stint events; resume by thread id.
3. MUST register both disabled in config, list them with honest gates (`observed`), and copy approved skills to `.claude/skills/<id>/SKILL.md` for Claude Code (R-048).

## Acceptance
1. Recorded stream fixtures for each map to the expected events and a priced run: `packages/adapters/claude-code/test/map.test.ts`, `packages/adapters/codex/test/map.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
