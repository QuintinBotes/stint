# Support

| Platform | Status | Notes |
|---|---|---|
| macOS 14 or later, Apple silicon | supported | CI runs every commit on `macos-latest`; the demo laptop is an M1 Max with 32 GB |
| Linux x86_64 and arm64 | supported | CI runs every commit on `ubuntu-latest`; Muse Code's sandbox needs `bubblewrap` |
| Windows | untested | WSL 2 with Ubuntu should behave like Linux; nothing is tested there |

## What each part needs

| Part | Needs | Without it |
|---|---|---|
| `stint demo` (the replay) | Bun 1.3.14 or later, git 2.40 or later | nothing else: no keys, no network, no Ollama |
| Muse Code runs | the `muse` CLI, logged in or with `META_API_KEY` | health says "unavailable" and assign refuses with `adapter_unavailable` |
| The Stint agent | `META_API_KEY`, or a partner key for Muse Spark Open | the same honest refusal |
| Planning with Muse Wonder | `META_API_KEY` | the planner chain falls to Fireworks, Baseten, Modal, then local Glimmer |
| Offline review | Ollama 0.32.8 or later with `muse-glimmer:30b-mlx` (about 19 GB; 32 GB of memory is comfortable) | the reviewer chain falls to the hosted Muse Spark Open hosts |
| The terminal pane | Bun's built-in terminal (`Bun.Terminal`, Bun 1.3.5 or later) | health reports the backend as unavailable and the pane says so |

Keys live in the environment or in a gitignored `.env`; Stint never writes them into `.stint/`, a packet or a log line.
