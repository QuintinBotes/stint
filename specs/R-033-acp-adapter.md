# R-033 · Agent Client Protocol adapter

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-032

## Goal
One adapter covers most agents: the Agent Client Protocol (JSON-RPC over stdio) is spoken by Gemini CLI, goose, opencode, Copilot CLI, Cursor and others. Stint is the client, so every file write and terminal command lands in the run's worktree, and every permission request becomes a Stint queue item: one approval layer across vendors.

## Requirements
1. MUST implement `packages/adapters/acp` exporting `acpAgent(name, def)`: spawn the agent's ACP command, `initialize`, `session/new` with the worktree as cwd, `session/prompt` with prompt.md, stream `session/update` notifications into `agent.message`, `agent.tool_call` and `agent.tool_result`, `session/cancel` on stop (killed), and map the prompt result's stop reason to `endedBy`.
2. MUST implement the client side of `fs/read_text_file`, `fs/write_text_file` (refusing any path outside the worktree with a `rule.blocked` event) and `terminal/*` (create, output, wait_for_exit, kill, release) run in the worktree.
3. MUST turn `session/request_permission` into `permission.requested { run, tool, options }`, shown as a queue row in the UI (Allow once, Always for this run, Reject), answered by `POST /api/tasks/:id/runs/:run/permission { requestId, option }` with `permission.decided`; unanswered requests wait, and a stop cancels them.
4. MUST register ACP agents from config (`agents.<name>.acp: true`), ship disabled presets for goose and opencode, and document running one on a Meta model through the OpenAI-compatible Meta API or Ollama.

## Acceptance
1. A fake ACP agent (a test script speaking the protocol) that reads, writes, runs a terminal command and asks permission produces the mapped events, a worktree write, a queue row, and finishes after the permission is granted: `packages/adapters/acp/test/acp.test.ts`.
2. A write outside the worktree is refused and recorded: same file.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
