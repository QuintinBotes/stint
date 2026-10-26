#!/usr/bin/env bash
# scripts/fixture.sh: unpack the demo fixture (demo/repo.bundle) into demo/repo with its own git history.
# Idempotent: an existing demo/repo is left alone. Tests never use this copy; they clone the bundle to a temp dir.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d demo/repo/.git ]; then
  echo "demo/repo is already unpacked"
  exit 0
fi
git clone -q demo/repo.bundle demo/repo
git -C demo/repo checkout -q main
echo "demo/repo unpacked at $(git -C demo/repo rev-parse --short HEAD)"
