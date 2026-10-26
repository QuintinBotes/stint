#!/usr/bin/env bash
# scripts/gate.sh <1|2|3|4>: run the checks for a gate and print PASS or FAIL per line.
# The human then writes "GATE n: PASS" (or FAIL <reason>) in PROGRESS.md and restarts the loop.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
n="${1:-}"; [ -n "$n" ] || { echo "usage: scripts/gate.sh <1|2|3|4>" >&2; exit 2; }

ok=0; bad=0
check() { # label, command...
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then printf 'PASS  %s\n' "$label"; ok=$((ok+1)); else printf 'FAIL  %s\n' "$label"; bad=$((bad+1)); fi
}

common() {
  check "typecheck" bun run typecheck
  check "unit tests" bun test
  check "identity guard" node scripts/guard-identity.mjs
}

case "$n" in
  1)
    common
    check "web build" bun run build:web
    check "replay plays end to end at speed 0" ./packages/cli/bin/stint demo --speed 0 --json
    check "ui tests against the replay" bun run test:ui
    ;;
  2)
    common
    check "killed run yields a valid packet" bun test packages/daemon/test/handoff.kill.test.ts
    check "live Muse Code to Claude Code continue passes verify (STINT_LIVE=1)" env STINT_LIVE=1 bun test packages/daemon/test/continue.live.test.ts
    check "hook drafts a packet" bun test packages/daemon/test/hooks.test.ts
    ;;
  3)
    common
    check "offline review and contradiction routing (STINT_LIVE=1, network off)" env STINT_LIVE=1 bun test packages/daemon/test/review.offline.test.ts packages/daemon/test/review.contradiction.test.ts
    check "approve merges with trailers" bun test packages/daemon/test/approve.test.ts
    check "graph queries and asOf" bun test packages/core/test/graph.asof.test.ts packages/core/test/graph.similar.test.ts
    check "ui: cards, gate, memory panel" bun run test:ui
    ;;
  4)
    common
    check "learn step proposes and mounts" bun test packages/daemon/test/learn.test.ts packages/daemon/test/skills.mount.test.ts
    check "replay fidelity to the live run" bun test packages/daemon/test/replay.fidelity.test.ts
    check "docs claims match tests and numbers" bun test packages/core/test/docs.claims.test.ts
    check "quick start on a clean clone" bash scripts/bootstrap.sh --check-only
    check "bench results exist" test -f bench/results.json
    ;;
  *) echo "gate must be 1..4" >&2; exit 2 ;;
esac

printf '\nGATE %s: %d passed, %d failed\n' "$n" "$ok" "$bad"
[ "$bad" = 0 ]
