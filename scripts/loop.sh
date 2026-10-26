#!/usr/bin/env bash
# scripts/loop.sh: run the spec-driven build loop until GOAL.md is met or a human is needed.
#
# Each iteration starts a fresh agent session with LOOP.md as its prompt. After a build
# iteration that marks a spec done, a review iteration (REVIEW.md) by the other vendor
# checks it. A spec that a vendor hands off twice goes to the other vendor, the way the
# product itself hands tasks between agents. The loop stops on: a new Blocked row, a gate
# waiting for a human, MAX_ITER reached, MAX_USD exceeded (approximate), or every spec done.
#
# Usage:  scripts/loop.sh [--builder muse|claude] [--reviewer claude|muse|none] [--once] [--self]
# Env:    MAX_ITER (40) MAX_USD (25) ITER_TIMEOUT (90m) MUSE_STEPS (80) CLAUDE_TURNS (60)
#         CLAUDE_PERMISSIONS (acceptEdits | bypass)   bypass only inside a sandbox or container
#         META_API_KEY ANTHROPIC_API_KEY as the CLIs expect
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
BUILDER="${BUILDER:-muse}"
REVIEWER="${REVIEWER:-claude}"
MAX_ITER="${MAX_ITER:-40}"
MAX_USD="${MAX_USD:-25}"
ITER_TIMEOUT="${ITER_TIMEOUT:-90m}"
MUSE_STEPS="${MUSE_STEPS:-80}"
CLAUDE_TURNS="${CLAUDE_TURNS:-60}"
CLAUDE_PERMISSIONS="${CLAUDE_PERMISSIONS:-acceptEdits}"
ONCE=0
SELF=0

while [ $# -gt 0 ]; do
  case "$1" in
    --builder) BUILDER="$2"; shift 2 ;;
    --reviewer) REVIEWER="$2"; shift 2 ;;
    --once) ONCE=1; shift ;;
    --self) SELF=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

mkdir -p .loop/logs
spent_usd=0
iter=0

log() { printf '%s loop: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

need() { command -v "$1" >/dev/null 2>&1 || { log "missing: $1"; exit 2; }; }
need git; need bun
[ "$BUILDER" = muse ] || [ "$REVIEWER" = muse ] && need muse
[ "$BUILDER" = claude ] || [ "$REVIEWER" = claude ] && need claude

# ---------- helpers over PROGRESS.md ----------

# status of a spec row:  spec_status R-003  -> todo|in_progress|handed|done|blocked|cut
spec_status() { awk -F'|' -v s="$1" '$2 ~ "^ *"s" *$" { gsub(/ /,"",$5); print $5; exit }' PROGRESS.md; }
spec_owner()  { awk -F'|' -v s="$1" '$2 ~ "^ *"s" *$" { gsub(/^ +| +$/,"",$6); print $6; exit }' PROGRESS.md; }
spec_attempts() { awk -F'|' -v s="$1" '$2 ~ "^ *"s" *$" { gsub(/ /,"",$7); print $7+0; exit }' PROGRESS.md; }

# the first eligible spec (handed > in_progress > todo, deps done), same rule as LOOP.md
next_spec() {
  local pref
  for pref in handed in_progress todo; do
    awk -F'|' -v pref="$pref" '
      /^\| [FR]-[0-9]+ \|/ {
        id=$2; gsub(/ /,"",id); st=$5; gsub(/ /,"",st); deps=$4; gsub(/ /,"",deps)
        if (st==pref) { print id "|" deps }
      }' PROGRESS.md | while IFS='|' read -r id deps; do
        ok=1
        if [ "$deps" != "-" ] && [ -n "$deps" ]; then
          IFS=',' read -ra ds <<< "$deps"
          for d in "${ds[@]}"; do [ "$(spec_status "$d")" = done ] || ok=0; done
        fi
        [ $ok = 1 ] && { echo "$id"; return 0; }
      done && return 0
  done
  return 1
}

gate_waiting() { grep -Eq '^\| [1-4] \| R-0[0-9]+ \| ready for review' PROGRESS.md; }
new_blocked() { [ "$(awk '/^## Blocked/{f=1;next} /^## /{f=0} f && /^\| 20/' PROGRESS.md | grep -c '| *|$' || true)" -gt 0 ]; }
all_done() { ! grep -Eq '^\| R-0[0-9]+ \|[^|]*\|[^|]*\| (todo|in_progress|handed|blocked) ' PROGRESS.md; }

changed_row() { git diff HEAD~1 -- PROGRESS.md | grep -E '^\+\| [FR]-[0-9]+ \|' | head -1 | sed 's/^+//'; }

append_spend() { # spec agent tokens usd wall
  printf '| %s | %s | %s | %s | %s | %s |\n' "$(date -u +%FT%TZ)" "$1" "$2" "$3" "$4" "$5" >> PROGRESS.md
}

# ---------- agent runners ----------

run_muse() { # prompt-file, extra text, log
  local pf="$1" extra="$2" out="$3" tmp
  tmp="$(mktemp)"; { cat "$pf"; printf '\n\n%s\n' "$extra"; } > "$tmp"
  timeout "$ITER_TIMEOUT" muse exec --json --prompt-file "$tmp" --disable-approval --max-model-steps "$MUSE_STEPS" > "$out" 2>&1 || true
  rm -f "$tmp"
  # best-effort usage from the last JSON line that carries it
  tail -200 "$out" | grep -E '"(usage|cost|total_cost_usd)"' | tail -1 || true
}

run_claude() { # prompt-file, extra text, log
  local pf="$1" extra="$2" out="$3" perm
  if [ "$CLAUDE_PERMISSIONS" = bypass ]; then perm=(--dangerously-skip-permissions); else perm=(--permission-mode acceptEdits --allowedTools "Bash,Read,Edit,Write,Glob,Grep"); fi
  timeout "$ITER_TIMEOUT" claude -p "$(cat "$pf"; printf '\n\n%s\n' "$extra")" --output-format json --max-turns "$CLAUDE_TURNS" "${perm[@]}" > "$out" 2>&1 || true
  grep -oE '"total_cost_usd":[0-9.]+' "$out" | tail -1 || true
}

run_agent() { # agent prompt-file extra log
  case "$1" in
    muse) run_muse "$2" "$3" "$4" ;;
    claude) run_claude "$2" "$3" "$4" ;;
    *) log "unknown agent $1"; exit 2 ;;
  esac
}

other_vendor() { [ "$1" = muse ] && echo claude || echo muse; }

# ---------- the loop ----------

while :; do
  iter=$((iter+1))
  if [ "$iter" -gt "$MAX_ITER" ]; then log "MAX_ITER reached"; break; fi
  if new_blocked; then log "a Blocked row is waiting for a human"; break; fi
  if gate_waiting; then log "a gate is waiting for a human (write GATE n: PASS in PROGRESS.md)"; break; fi
  if all_done; then log "every spec is done or cut; run scripts/gate.sh 4 for the final check"; break; fi
  if ! git diff --quiet; then git add -A; git commit -qm "loop: wip left by previous iteration"; fi

  spec="$(next_spec || true)"
  if [ -z "$spec" ]; then log "no eligible spec; check dependencies in PROGRESS.md"; break; fi

  # cross-vendor continue: a spec handed off twice by one vendor goes to the other
  agent="$BUILDER"
  if [ "$(spec_status "$spec")" = handed ] && [ "$(spec_attempts "$spec")" -ge 2 ]; then
    case "$(spec_owner "$spec")" in
      muse-code*|muse*) agent=claude ;;
      claude*) agent=muse ;;
    esac
    log "$spec handed twice by $(spec_owner "$spec"); continuing with $agent"
  fi

  if [ "$SELF" = 1 ] && [ "$(spec_status R-017)" = done ]; then
    # From R-017 on the repo builds itself with itself: the loop becomes a Stint task.
    log "self mode: creating a Stint task for $spec"
    ./packages/cli/bin/stint new "$(grep -m1 '^# ' "specs/$spec"-*.md | sed 's/^# //')" --goal "Implement specs/$spec per LOOP.md" --test "bun test" --json > ".loop/$spec.task.json" || true
  fi

  log "iteration $iter: $agent builds $spec"
  out=".loop/logs/$(printf '%03d' "$iter")-build-$spec-$agent.log"
  t0=$(date +%s)
  usage="$(run_agent "$agent" LOOP.md "Spec to take this iteration: $spec. Your adapter/model for the Owner column: $agent." "$out")"
  wall=$(( $(date +%s) - t0 ))
  usd="$(echo "$usage" | grep -oE '[0-9]+\.[0-9]+' | tail -1 || true)"; usd="${usd:-0}"
  spent_usd="$(awk -v a="$spent_usd" -v b="$usd" 'BEGIN{print a+b}')"
  append_spend "$spec" "$agent" "see log" "$usd" "${wall}s"
  git add -A; git commit -qm "loop: spend row for iteration $iter" || true

  row="$(changed_row || true)"
  log "row: ${row:-<none>}"

  # review when the builder marked the spec done
  if [ "$REVIEWER" != none ] && echo "$row" | grep -q "| done |"; then
    rev="$REVIEWER"; [ "$rev" = "$agent" ] && rev="$(other_vendor "$agent")"
    log "iteration $iter: $rev reviews $spec"
    rout=".loop/logs/$(printf '%03d' "$iter")-review-$spec-$rev.log"
    t0=$(date +%s)
    usage="$(run_agent "$rev" REVIEW.md "Spec to review: $spec. Your adapter/model for the Reviewer column: $rev." "$rout")"
    wall=$(( $(date +%s) - t0 ))
    usd="$(echo "$usage" | grep -oE '[0-9]+\.[0-9]+' | tail -1 || true)"; usd="${usd:-0}"
    spent_usd="$(awk -v a="$spent_usd" -v b="$usd" 'BEGIN{print a+b}')"
    append_spend "$spec" "review:$rev" "see log" "$usd" "${wall}s"
    git add -A; git commit -qm "loop: spend row for review $iter" || true
  fi

  if awk -v a="$spent_usd" -v m="$MAX_USD" 'BEGIN{exit !(a>m)}'; then log "MAX_USD ($MAX_USD) exceeded: $spent_usd; stopping for a human"; break; fi
  [ "$ONCE" = 1 ] && break
done

log "stopped after $iter iteration(s); spent ≈ \$$spent_usd; see .loop/logs and PROGRESS.md"
