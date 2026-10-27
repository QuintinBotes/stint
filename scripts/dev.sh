#!/usr/bin/env bash
# scripts/dev.sh: the daemon under bun --watch on a fixed port, and Vite's dev server proxying /api to it.
# A change to a daemon file restarts the daemon; a change to the UI reloads in place. `bun run demo` is the replay.
set -euo pipefail
cd "$(dirname "$0")/.."
port="${STINT_DEV_PORT:-4318}"
trap 'kill 0' EXIT
bun --watch packages/cli/bin/stint up --port "$port" &
STINT_DAEMON="http://127.0.0.1:${port}" bun run --cwd apps/web dev
