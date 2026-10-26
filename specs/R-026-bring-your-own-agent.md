# R-026 · Bring your own agent

Day: 6 (1 Nov) · Owner: Q · Depends on: R-012 · Fallback: document the adapter contract only · Cut order: 6

## Goal
Any coding agent with a command line can take a Stint task: it gets the same worktree, `prompt.md` with the packet, the daemon's verification, the packet on every ending and the cost meter. Meta's models stay the default and the demo; this spec is what makes "the packet is vendor-neutral" true for every agent a person already uses.

## Requirements
1. MUST add `agents` to `.stint/config.json`: named entries `{ command: string[], prompt: 'file' | 'stdin' | 'arg', roles, vendor: 'meta' | 'openai' | 'local' | 'other', model?, enabled }` where `{prompt}` and `{model}` in `command` are substituted; presets for two common agent CLIs ship disabled.
2. MUST implement `packages/adapters/cli-agent` exporting `cliAgent(name, def): Adapter`: spawn in the worktree's process group with the run environment, stream stdout lines to `agent.message` (2 KB each, full lines in the transcript), stderr's last line on failure, `killed` on abort or SIGKILL, `completed` on exit 0, `failed` otherwise; usage is unknown, so the cost is unpriced (`estimated: true`).
3. MUST register every enabled entry as an adapter at daemon start, listed in `/api/health` with `gate: 'observed'` and its availability (`command[0]` on PATH).
4. MUST add `other` to the vendor enum in the handoff and event schemas (R-002 schemas), so any agent's run is shown honestly.

## Acceptance
1. A config entry running a shell script that edits a file and prints two lines yields a run with two `agent.message` events, a wip commit, a packet and a verification: `packages/adapters/cli-agent/test/cli.test.ts`.
2. A disabled preset is not registered; an enabled entry whose command is missing shows `unavailable` with the reason: same file.

## Verify
```
bun test packages/adapters/cli-agent packages/daemon
```

## Out of scope
Parsing a particular agent's JSON stream (Muse Code has its own adapter), hooks for other agents.
