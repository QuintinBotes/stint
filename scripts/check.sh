#!/usr/bin/env bash
# scripts/check.sh: the checks every commit must pass, judged by exit codes (never by reading the tail of the output).
set -euo pipefail
cd "$(dirname "$0")/.."
bun run typecheck
bun test
node scripts/guard-identity.mjs
bun run build:web >/dev/null
echo "check: all green"
