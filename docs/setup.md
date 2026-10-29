# Setup

This guide is for anyone installing Stint on their own machine: install it, run it on your repository, and remove it again. The [README](../README.md) has the short version. Every shell block on this page runs in a test (`packages/cli/test/readme.commands.test.ts`), except those marked with what they need.

Two folders appear below: the Stint checkout (`/path/to/stint`) and your repository (`/path/to/your/repo`).

## Platforms

| Platform | Status | Notes |
|---|---|---|
| macOS 14 or later, Apple silicon | supported | CI runs every commit on `macos-latest` |
| Linux x86_64 and arm64 | supported | CI runs every commit on `ubuntu-latest`; Muse Code's sandbox needs `bubblewrap` |
| Windows | untested | WSL 2 with Ubuntu should behave like Linux; nothing is tested there |

## What each part needs

| Part | Needs | Without it |
|---|---|---|
| The replay (`stint demo`) | Bun 1.3.14 or later, git 2.40 or later | nothing else: no keys, no network, no Ollama |
| Muse Code runs | the `muse` CLI, logged in | without the CLI, health says unavailable and assign refuses with `adapter_unavailable`; without the login, the run fails with Muse's own message |
| The Stint agent | `META_API_KEY`, a partner key for Muse Spark Open, or Glimmer running in Ollama | the same refusal |
| Planning with Muse Wonder | `META_API_KEY` | the planner falls back to Fireworks, Baseten, Modal, then local Glimmer |
| The offline review | Ollama 0.32.8 or later with `muse-glimmer:30b-mlx` (about 19 GB; 32 GB of memory is comfortable) | the reviewer falls back to Muse Spark Open on Fireworks, Baseten and Modal, then Muse Spark 1.3 on the Meta Model API |
| Visual checks | `META_API_KEY`, `visual` in `.stint/config.json`, and the Chromium that Playwright installs (`bunx playwright install chromium`) | a visual proof reads "not checked" with the reason, and the verification stays as the tests left it ([`verify.md`](verify.md#what-stint-saw-visual-checks)) |
| The terminal pane | `Bun.Terminal`, which every Bun that Stint supports has | health reports the terminal as unavailable, and the pane says so |

## Install

Clone the repository and install its dependencies:

<!-- needs: network (the clone and bun install download packages) -->
```bash
git clone https://github.com/QuintinBotes/stint && cd stint
bun install
```

Put `stint` on your PATH. The installer writes a small shim that runs this checkout's CLI into `$STINT_BIN_DIR` when it is set, else into `--dir <folder>`, else into `~/.local/bin`. Running it again changes nothing, and it prints the line to add when the folder is not on your PATH:

```bash
cd /path/to/stint
bash scripts/install-cli.sh
stint --help
```

`stint doctor` then checks the machine and a repository: Bun and git versions, the shim, the daemon, the repository's state, each key's source, each enabled agent, Ollama and the reviewer model, and the sandbox. Each line is `ok`, `warn` or `fail`, with the command that fixes it, and it exits 1 when any line fails. Add `--json` for a machine-readable report and `--repo <path>` to check another folder.

## Keys

Stint reads each key from the first of these places that has it:

1. The environment of the shell that runs `stint`.
2. `.env` in your repository, only when git ignores it. A tracked or unignored `.env` is refused and never read, and `stint doctor` fails on it.
3. The user-level file, `$XDG_CONFIG_HOME/stint/env` (by default `~/.config/stint/env`). Stint warns when others can read it (a mode wider than `0600`).
4. `.env` in the Stint checkout, for setups that followed an older README. Stint prints a note naming the user-level file.

The user-level file works from every repository, so it is the one to use. `stint keys set` reads the value without echoing it and writes the file with mode `0600`. It accepts only the names Stint reads: each host's key and address variables and each agent's `env` entries, in the defaults and in your config:

<!-- needs: META_API_KEY -->
```bash
stint keys set META_API_KEY
```

`stint keys list` shows each name, where it comes from, and whether it is set. Values never reach a log, an event, a packet or the UI:

```bash
stint keys list
```

## Your first task

The README's [Use it on your repository](../README.md#use-it-on-your-repository) walks through it with the expected output: `stint init`, keys, `stint up`, `stint new`, `stint run`, the gate and `stint approve`. To start from a sentence instead of a form, `stint draft "<what you want>"` drafts the spec with you, or press n in the web UI. Before a run, `stint sharpen <task>` asks the few questions whose answers change what gets built, and for work bigger than one task, `stint goal new` makes a goal that splits into tasks ([`sharpen.md`](sharpen.md)). `stint list` prints every task with its status. After a merge, `stint outcome <task>` says how the task went: each criterion and its proof, the loops, the spend and what happened since. Four things to know before you start:

- **A clean tree.** A run starts from your last commit in its own worktree under `.stint/worktrees/`, on the branch `stint/<task>`. Uncommitted changes to tracked files stop it with `dirty_tree`, so commit or stash them first.
- **The test command.** The daemon runs the task's test command itself after every run. It is `testCommand` in `.stint/config.json` (`bun test` until you change it), or `stint new --test "<command>"` for one task.
- **Limits.** Autopilot stops and asks you once a task reaches one of its limits: 8 builds, 3 hand-offs and 1 review round by default, and no limit on spend or agent time until you set one. `stint new "<title>" --max-usd 3` sets them for one task, `stint limits <task>` shows and changes them, and `limits` in `.stint/config.json` sets the defaults ([`factory.md`](factory.md#limits-you-set)).
- **The gate.** Nothing merges until you approve. Approval is a real merge of the commit the daemon verified, with `Stint-Task` trailers naming the runs and the packet it came from. To send work back, `stint changes <task> --reason "<what should change>"` or `stint reject <task> --reason "<why>"` makes your words the next run's ask.

## Other agents

Muse Code and the Stint agent build, Muse Wonder plans, and Muse Glimmer reviews. Claude Code, Codex, goose, opencode, Gemini CLI, aider and any Agent Client Protocol agent ship turned off. To turn one on, set `enabled` to `true` in its entry under `agents` in `.stint/config.json` and restart `stint up`. [`agents.md`](agents.md) has every preset, the hosts each can run on (including Meta's models through Ollama or the Meta Model API), and how keys reach them.

To work the other way round, with the agent you already use calling Stint's tools over MCP, register Stint's server with it in one line from your repository. Add `--print` to see the command first ([`mcp.md`](mcp.md#connect-an-agent)):

<!-- needs: Claude Code or Codex, whose config this changes -->
```bash
cd /path/to/your/repo
stint mcp install claude
stint mcp install codex
```

## The offline review

The reviewer runs Muse Glimmer 30B on your machine through Ollama, at no cost and with the network off. Only this review needs the model, so `scripts/bootstrap.sh` downloads nothing for it unless you pass `--with-glimmer`, which starts the pull in the background. Or pull the model yourself, once:

<!-- needs: muse-glimmer:30b-mlx (a 19 GB download) -->
```bash
ollama pull muse-glimmer:30b-mlx
```

A cold load can take several minutes when another large model is resident. Load it before a session you care about:

<!-- needs: muse-glimmer:30b-mlx and a running Ollama -->
```bash
curl -s localhost:11434/api/generate -d '{"model":"muse-glimmer:30b-mlx","prompt":"ok","keep_alive":"60m","stream":false}'
```

When Ollama or the model is missing, the reviewer falls back to the hosted chain and the review card says which host reviewed.

## Updating

Pull the checkout and install again. The shim points at the checkout, so it needs no change:

<!-- needs: network -->
```bash
cd /path/to/stint
git pull && bun install
```

## Uninstalling

Stop `stint up` first. In your repository, remove the run worktrees, the task branches and the workspace:

```bash
cd /path/to/your/repo
git worktree list --porcelain | sed -n 's|^worktree \(.*/\.stint/worktrees/.*\)|\1|p' | while read -r w; do git worktree remove --force "$w"; done
git worktree prune
git for-each-ref --format='%(refname:short)' 'refs/heads/stint/*' | while read -r b; do git branch -D "$b"; done
rm -rf .stint
```

`stint init` also added a Stint section to `AGENTS.md` and lines to `.gitignore`; remove them by hand if you want them gone. Then remove the shim (it deletes only a file it wrote) and the user-level key file:

```bash
cd /path/to/stint
bash scripts/install-cli.sh --uninstall
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/stint/env"
```

If you installed the Stint plugin for Muse Code:

<!-- needs: muse -->
```bash
muse plugins remove stint
```
