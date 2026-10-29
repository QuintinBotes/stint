# Stint over MCP

This page is for anyone connecting a coding agent or another MCP client to Stint. `stint mcp` serves Stint's tools over the Model Context Protocol on stdio, so any agent that speaks MCP can use Stint's tasks, packets, memory and decisions as tools while it works. Every call goes through the running daemon (`stint up`), so the daemon stays the only writer of `.stint/`.

## Tools

| Tool | What it does |
|---|---|
| `stint_status` | every task: its status, who holds it, its cost, its autopilot step |
| `stint_task` | one task in full: goal, acceptance, runs, the daemon's verification, the review, the decisions in force |
| `stint_new_task` | create a task; it appears on the Board (`/`) as planned |
| `stint_packet` | a task's packet as the next agent reads it |
| `stint_similar` | earlier tasks like this one, with the evidence (shared files, the same findings, tags) |
| `stint_constraints` | the decisions and open review findings on the files the task touches, across every task |
| `stint_files_together` | files that changed alongside a file in earlier runs |
| `stint_decide` | record a decision, or one that supersedes an earlier one |
| `stint_hand` | hand a task to another agent, from a packet addressed to it |
| `stint_autopilot` | put a task on autopilot, or take it off |
| `stint_verify` | have the daemon run the tests and report the result |

Approving, rejecting and merging are not tools. A person does those.

Inside a Stint run, `task` defaults to the run's task, so an agent can call `stint_constraints` or `stint_decide` with no arguments. There the server calls the daemon with the run's own token, which changes only that task: recording a decision and autopilot work, and changing another task is refused ([`sandbox.md`](sandbox.md#a-sandbox-per-run)). The server lists 8 of its 11 tools there. It leaves out `stint_new_task`, because a run token cannot create a task, and `stint_hand` and `stint_verify`, because both wait for the task's live run to end, and the caller's own run is that run.

## Connect an agent

**Muse Code:** install the Stint plugin once. It registers the MCP server and the hooks:

```bash
muse plugins install /path/to/stint/packages/adapters/muse-code/plugin --scope user
muse plugins approve stint
```

**Claude Code or Codex:** one line from your repository registers the server through the tool's own CLI and prints what it changed:

```bash
cd /path/to/your/repo
stint mcp install claude
stint mcp install codex
```

`stint mcp install claude` runs `claude mcp add stint -- stint mcp --repo <your repo>`, which Claude Code keeps in its local scope: that folder, for you. `stint mcp install codex` runs `codex mcp add` with the same command, which writes `[mcp_servers.stint]` to `~/.codex/config.toml` for every Codex session. Add `--print` to see the command without running it, and `--repo <path>` for another repository. When `stint` is not on your PATH, the command names this checkout's `packages/cli/bin/stint` instead.

**Any other MCP client:** run `stint mcp` from the repository, or pass `--repo <path>`. For a client configured with JSON:

```json
{ "mcpServers": { "stint": { "command": "stint", "args": ["mcp", "--repo", "/path/to/your/repo"] } } }
```

With no daemon running, every tool answers with how to start one instead of failing silently.
