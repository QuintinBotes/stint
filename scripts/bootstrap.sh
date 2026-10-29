#!/usr/bin/env bash
# scripts/bootstrap.sh: take a fresh clone to a running daemon and UI.
# Usage: scripts/bootstrap.sh [--check-only] [--with-glimmer]
# --with-glimmer also starts the Glimmer download for the offline review; nothing else downloads a model.
# Exit codes: 0 ok, 2 missing Bun or git, 3 install failed.
set -uo pipefail
cd "$(dirname "$0")/.."

CHECK_ONLY=0; WITH_GLIMMER=0
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    --with-glimmer) WITH_GLIMMER=1 ;;
  esac
done
GLIMMER="muse-glimmer:30b-mlx"

say() { printf '%s\n' "$*"; }
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

# A key counts when it is in the environment, in the user-level key file, or in .env, as stint loads them.
# Values are never printed.
USER_KEYS="${XDG_CONFIG_HOME:-$HOME/.config}/stint/env"
has_key() {
  [ -n "${!1:-}" ] && return 0
  [ -f "$USER_KEYS" ] && grep -Eq "^(export )?$1=.+" "$USER_KEYS" && return 0
  [ -f .env ] && grep -Eq "^(export )?$1=.+" .env
}

if ! command -v bun >/dev/null 2>&1; then say "bun: missing. Install Bun 1.3.14 or later: https://bun.sh"; exit 2; fi
bun_v="$(bun --version)"
if ! version_ge "$bun_v" 1.3.14; then say "bun: $bun_v is too old; Stint needs 1.3.14 or later"; exit 2; fi
if ! command -v git >/dev/null 2>&1; then say "git: missing. Install git 2.40 or later"; exit 2; fi
git_v="$(git --version | awk '{print $3}')"
if ! version_ge "$git_v" 2.40; then say "git: $git_v is too old; Stint needs 2.40 or later"; exit 2; fi
say "bun $bun_v, git $git_v"

ollama_ok=0; glimmer_ok=0
if command -v ollama >/dev/null 2>&1; then
  ollama_ok=1
  if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$GLIMMER"; then glimmer_ok=1; fi
else
  say "ollama: not installed (optional; the offline review needs it: https://ollama.com)"
fi

if [ "$CHECK_ONLY" = 0 ]; then
  if ! bun install --frozen-lockfile; then say "bun install failed"; exit 3; fi
  bash scripts/fixture.sh || { say "could not unpack the demo fixture"; exit 3; }
  if [ "$ollama_ok" = 1 ] && [ "$glimmer_ok" = 0 ] && [ "$WITH_GLIMMER" = 1 ]; then
    say "ollama: pulling $GLIMMER in the background (about 19 GB)"
    nohup ollama pull "$GLIMMER" >/dev/null 2>&1 &
  fi
fi
if [ "$ollama_ok" = 1 ] && [ "$glimmer_ok" = 0 ] && { [ "$WITH_GLIMMER" = 0 ] || [ "$CHECK_ONLY" = 1 ]; }; then
  say "ollama: $GLIMMER is not pulled. Only the offline review needs it: about 19 GB to download, and 32 GB of memory is comfortable. To get it: bash scripts/bootstrap.sh --with-glimmer"
fi

# keys live in the user-level file, which works from every repository (docs/setup.md#keys); the replay needs none
if [ "$CHECK_ONLY" = 0 ] && ! has_key META_API_KEY; then
  say "keys: none needed for the replay; for live runs, stint keys set META_API_KEY"
fi

say ""
say "Adapters:"
if command -v muse >/dev/null 2>&1; then
  if has_key META_API_KEY; then say "  muse-code      available: $(muse --version 2>/dev/null | head -1), META_API_KEY set"
  else say "  muse-code      available: $(muse --version 2>/dev/null | head -1), using the stored muse login (not checked here)"; fi
else
  say "  muse-code      unavailable: muse CLI not installed (https://dev.meta.ai/install.sh)"
fi
if has_key META_API_KEY || has_key FIREWORKS_API_KEY || has_key BASETEN_API_KEY; then say "  stint-agent    key set for Muse Spark (not checked here; stint up --check asks the host)"
else say "  stint-agent    unavailable: no META_API_KEY, FIREWORKS_API_KEY or BASETEN_API_KEY"; fi
if [ "$glimmer_ok" = 1 ]; then say "  ollama         available: $GLIMMER pulled (offline review, \$0)"
elif [ "$ollama_ok" = 1 ]; then say "  ollama         unavailable: $GLIMMER not pulled yet (ollama pull $GLIMMER)"
else say "  ollama         unavailable: ollama not installed"; fi

say "Hosts for plan, review and learn:"
for pair in "meta-api:META_API_KEY" "fireworks:FIREWORKS_API_KEY" "baseten:BASETEN_API_KEY" "modal:MODAL_API_KEY"; do
  host="${pair%%:*}"; key="${pair##*:}"
  if has_key "$key"; then say "  $(printf '%-14s' "$host") key set (not checked here; stint up --check asks the host)"
  else say "  $(printf '%-14s' "$host") unavailable: $key not set"; fi
done

if [ "$CHECK_ONLY" = 1 ]; then
  # once the stint command is installed, its doctor checks the rest: the repository, keys by source, agents, Ollama
  if command -v stint >/dev/null 2>&1; then say ""; stint doctor || true; fi
  exit 0
fi
say ""
if ! command -v stint >/dev/null 2>&1; then
  say "To use stint from any folder, install the command: bash scripts/install-cli.sh"
  say ""
fi
exec bun run demo
