#!/usr/bin/env bash
# scripts/loop.sh: run the spec-driven build loop until GOAL.md is met or a human is needed.
#
# Each iteration starts a fresh agent session with LOOP.md as its prompt. After a build
# iteration that marks a spec done, a review iteration (REVIEW.md) on a different model
# checks it, so the generator is never its own judge. A spec handed off twice on one model
# goes to the other model, the way the product hands a task between agents. The loop stops
# on: a new Blocked row, a gate waiting for a human, MAX_ITER reached, MAX_USD exceeded
# (approximate), or every spec done.
#
# Usage:  scripts/loop.sh [--reviewer muse|none] [--once] [--self]
# Env:    MAX_ITER (40) MAX_USD (25) ITER_TIMEOUT (90m) MUSE_STEPS (80)
#         BUILD_MODEL (muse-wonder-full-1.0) REVIEW_MODEL (muse-spark-1.3)
#         META_API_KEY or a stored muse login
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
REVIEWER="${REVIEWER:-muse}"
BUILD_MODEL="${BUILD_MODEL:-muse-wonder-full-1.0}"
REVIEW_MODEL="${REVIEW_MODEL:-muse-spark-1.3}"
MAX_ITER="${MAX_ITER:-40}"
MAX_USD="${MAX_USD:-25}"
ITER_TIMEOUT="${ITER_TIMEOUT:-90m}"
MUSE_STEPS="${MUSE_STEPS:-80}"
ONCE=0
SELF=0

while [ $# -gt 0 ]; do
  case "$1" in
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
need git; need bun; need muse
# macOS has no timeout(1); use coreutils' gtimeout when present, else run without a wall clock cap
if command -v timeout >/dev/null 2>&1; then TIMEOUT=(timeout "$ITER_TIMEOUT")
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT=(gtimeout "$ITER_TIMEOUT")
else TIMEOUT=(); log "no timeout(1): iterations run without the ${ITER_TIMEOUT} cap"; fi

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

run_muse() { # model, prompt-file, extra text, log
  local model="$1" pf="$2" extra="$3" out="$4" tmp
  tmp="$(mktemp)"; { cat "$pf"; printf '\n\n%s\n' "$extra"; } > "$tmp"
  "${TIMEOUT[@]}" muse exec --json --model "$model" --prompt-file "$tmp" --trust-workspace --max-model-steps "$MUSE_STEPS" > "$out" 2>&1 || true
  rm -f "$tmp"
  # best-effort usage from the run.usage record
  grep -E '"run.usage"' "$out" | tail -1 || true
}

# USD for one Muse run from its run.usage record (input includes cached), at list prices per million
price_usage() { # usage-line, model
  local line="$1" model="$2" i c o rin rc rout
  [ -n "$line" ] && command -v jq >/dev/null 2>&1 || { echo 0; return; }
  read -r i c o < <(echo "$line" | jq -r '[.payload.models[]? | .input_tokens, .cached_tokens, .output_tokens] as $x | [($x | [.[range(0; length; 3)]] | add // 0), ($x | [.[range(1; length; 3)]] | add // 0), ($x | [.[range(2; length; 3)]] | add // 0)] | @tsv')
  case "$model" in muse-wonder*) rin=4; rc=0.2; rout=20 ;; *) rin=1.25; rc=0.15; rout=5 ;; esac
  awk -v i="$i" -v c="$c" -v o="$o" -v a="$rin" -v b="$rc" -v d="$rout" 'BEGIN{printf "%.4f", ((i-c)*a + c*b + o*d)/1000000}'
}

other_model() { [ "$1" = "$BUILD_MODEL" ] && echo "$REVIEW_MODEL" || echo "$BUILD_MODEL"; }

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

  # cross-model continue: a spec handed off twice on one model goes to the other
  model="$BUILD_MODEL"
  if [ "$(spec_status "$spec")" = handed ] && [ "$(spec_attempts "$spec")" -ge 2 ]; then
    case "$(spec_owner "$spec")" in
      *"$BUILD_MODEL"*) model="$REVIEW_MODEL" ;;
    esac
    log "$spec handed twice by $(spec_owner "$spec"); continuing on $model"
  fi

  if [ "$SELF" = 1 ] && [ "$(spec_status R-017)" = done ]; then
    # From R-017 on the repo builds itself with itself: the loop becomes a Stint task.
    log "self mode: creating a Stint task for $spec"
    ./packages/cli/bin/stint new "$(grep -m1 '^# ' "specs/$spec"-*.md | sed 's/^# //')" --goal "Implement specs/$spec per LOOP.md" --test "bun test" --json > ".loop/$spec.task.json" || true
  fi

  log "iteration $iter: muse-code/$model builds $spec"
  out=".loop/logs/$(printf '%03d' "$iter")-build-$spec-$model.log"
  t0=$(date +%s)
  usage="$(run_muse "$model" LOOP.md "Spec to take this iteration: $spec. Your adapter/model for the Owner column: muse-code/$model." "$out")"
  wall=$(( $(date +%s) - t0 ))
  usd="$(price_usage "$usage" "$model")"
  spent_usd="$(awk -v a="$spent_usd" -v b="$usd" 'BEGIN{print a+b}')"
  append_spend "$spec" "muse-code/$model" "see log" "$usd" "${wall}s"
  git add -A; git commit -qm "loop: spend row for iteration $iter" || true

  row="$(changed_row || true)"
  log "row: ${row:-<none>}"

  # review when the builder marked the spec done
  if [ "$REVIEWER" != none ] && echo "$row" | grep -q "| done |"; then
    rev="$(other_model "$model")"
    log "iteration $iter: muse-code/$rev reviews $spec"
    rout=".loop/logs/$(printf '%03d' "$iter")-review-$spec-$rev.log"
    t0=$(date +%s)
    usage="$(run_muse "$rev" REVIEW.md "Spec to review: $spec. Your adapter/model for the Reviewer column: muse-code/$rev." "$rout")"
    wall=$(( $(date +%s) - t0 ))
    usd="$(price_usage "$usage" "$rev")"
    spent_usd="$(awk -v a="$spent_usd" -v b="$usd" 'BEGIN{print a+b}')"
    append_spend "$spec" "review:muse-code/$rev" "see log" "$usd" "${wall}s"
    git add -A; git commit -qm "loop: spend row for review $iter" || true
  fi

  if awk -v a="$spent_usd" -v m="$MAX_USD" 'BEGIN{exit !(a>m)}'; then log "MAX_USD ($MAX_USD) exceeded: $spent_usd; stopping for a human"; break; fi
  [ "$ONCE" = 1 ] && break
done

log "stopped after $iter iteration(s); spent ≈ \$$spent_usd; see .loop/logs and PROGRESS.md"
