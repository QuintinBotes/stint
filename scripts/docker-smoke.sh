#!/usr/bin/env bash
# scripts/docker-smoke.sh: prove the image does what docs/docker.md says.
# Usage: scripts/docker-smoke.sh [image]   (default stint:local; build it first with docker build -t stint:local .)
# Runs the replay, then `stint up` on a throwaway repository with the hardening compose.yaml uses,
# each published on 127.0.0.1 only. Exit 0 when every check passes.
set -euo pipefail
IMAGE="${1:-stint:local}"
PORT="${STINT_SMOKE_PORT:-14319}"
NAME="stint-smoke-$$"
WORK="$(mktemp -d)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$*"; docker logs "$NAME" 2>&1 | tail -20; exit 1; }
ok() { printf 'ok: %s\n' "$*"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
wait_healthy() {
  for _ in $(seq 1 90); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ] && return 0
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] || fail "the container stopped before it was healthy"
    sleep 1
  done
  fail "not healthy after 90 s"
}
stops_cleanly() {
  docker stop -t 20 "$NAME" >/dev/null
  [ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = 0 ] || fail "$1 did not exit 0 on docker stop"
  ok "docker stop ends $1 with exit 0"
  docker rm "$NAME" >/dev/null
}

docker run -d --name "$NAME" -p "127.0.0.1:$PORT:4319" "$IMAGE" >/dev/null
wait_healthy
[ "$(code "http://127.0.0.1:$PORT/api/health")" = 200 ] || fail "health is not 200"
curl -s "http://127.0.0.1:$PORT/" | grep -q 'name="stint-token"' || fail "the web UI is not served"
[ "$(code -H 'Host: evil.example.com' "http://127.0.0.1:$PORT/api/health")" = 401 ] || fail "a Host other than localhost is not refused"
[ "$(code -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/tasks")" = 401 ] || fail "a change without the token is not refused"
ok "the replay serves the UI and the API on 127.0.0.1:$PORT, and refuses another Host and a change without the token"
stops_cleanly "the replay"

git -C "$WORK" init -q -b main
git -C "$WORK" -c user.name=smoke -c user.email=smoke@example.com commit -q --allow-empty -m init
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:4319" -v "$WORK:/repo" \
  --user "$(id -u):$(id -g)" --read-only --tmpfs /tmp --tmpfs /home/stint \
  --cap-drop ALL --security-opt no-new-privileges:true \
  "$IMAGE" up --repo /repo >/dev/null
wait_healthy
[ -f "$WORK/.stint/cache/daemon.json" ] || fail "the daemon did not write .stint/ in the mounted repository"
[ "$(code "http://127.0.0.1:$PORT/api/tasks")" = 200 ] || fail "the task list is not 200"
ok "stint up runs on a mounted repository as $(id -u):$(id -g), read-only, with no capabilities"
stops_cleanly "stint up"
[ ! -f "$WORK/.stint/cache/daemon.json" ] || fail "daemon.json is left behind after the stop"
ok "the stop removes daemon.json, as on a machine"
