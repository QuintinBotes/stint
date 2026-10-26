#!/usr/bin/env bash
# scripts/bootstrap.sh: take a fresh clone to a running daemon and UI.
# Usage: scripts/bootstrap.sh [--check-only]
# Exit codes: 0 ok, 2 missing Bun or git, 3 install failed.
set -uo pipefail
cd "$(dirname "$0")/.."

CHECK_ONLY=0
[ "${1:-}" = "--check-only" ] && CHECK_ONLY=1
GLIMMER="muse-glimmer:30b-mlx"

say() { printf '%s\n' "$*"; }
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

# A key counts when it is in the environment or set to a non-empty value in .env. Values are never printed.
has_key() {
  [ -n "${!1:-}" ] && return 0
  [ -f .env ] && grep -Eq "^$1=.+" .env
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
  if [ "$ollama_ok" = 1 ] && [ "$glimmer_ok" = 0 ]; then
    say "ollama: pulling $GLIMMER in the background (about 19 GB)"
    nohup ollama pull "$GLIMMER" >/dev/null 2>&1 &
  fi
fi

if [ ! -f .env ] && [ -f .env.example ]; then
  if [ "$CHECK_ONLY" = 0 ]; then cp .env.example .env; say ".env created from .env.example; add your keys there"; fi
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

if [ "$CHECK_ONLY" = 1 ]; then exit 0; fi
say ""
exec bun run dev
