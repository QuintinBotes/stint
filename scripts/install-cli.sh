#!/usr/bin/env bash
# scripts/install-cli.sh: put a `stint` command on PATH that runs this checkout's CLI with Bun.
# Usage: scripts/install-cli.sh [--dir <bin dir>] [--uninstall]
# The shim goes into $STINT_BIN_DIR, else --dir, else ~/.local/bin. Running it again changes nothing.
# --uninstall removes only a shim this script wrote; any other file named stint is left alone.
set -euo pipefail

MARKER="# stint shim, written by scripts/install-cli.sh"
checkout="$(cd "$(dirname "$0")/.." && pwd)"
dir=""
uninstall=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) dir="${2:?--dir needs a folder}"; shift 2 ;;
    --uninstall) uninstall=1; shift ;;
    -h|--help) sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install-cli: unknown option $1 (try --help)" >&2; exit 2 ;;
  esac
done
dir="${STINT_BIN_DIR:-${dir:-$HOME/.local/bin}}"
shim="$dir/stint"

written_by_us() { [ -f "$1" ] && grep -qxF "$MARKER" "$1"; }

if [ "$uninstall" = 1 ]; then
  if written_by_us "$shim"; then
    rm -f "$shim"
    echo "Removed $shim."
  elif [ -e "$shim" ]; then
    echo "Left $shim alone: this script did not write it."
  else
    echo "Nothing to remove: there is no $shim."
  fi
  exit 0
fi

content="#!/bin/sh
$MARKER
exec bun \"$checkout/packages/cli/bin/stint\" \"\$@\""

if [ -e "$shim" ] && ! written_by_us "$shim"; then
  echo "install-cli: $shim exists and this script did not write it; remove it yourself, or pass --dir <another folder>" >&2
  exit 1
fi
if [ -f "$shim" ] && [ "$(cat "$shim")" = "$content" ]; then
  echo "stint is already installed at $shim."
else
  mkdir -p "$dir"
  printf '%s\n' "$content" > "$shim"
  chmod 755 "$shim"
  echo "Installed stint at $shim. It runs $checkout."
fi

case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "$dir is not on your PATH. Add this line to your shell profile (~/.zshrc or ~/.bashrc):"
     echo "  export PATH=\"$dir:\$PATH\"" ;;
esac
