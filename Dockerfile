# syntax=docker/dockerfile:1
# Stint in a container: the daemon, the CLI and the web UI.
#   docker build -t stint .
#   docker run --rm -p 127.0.0.1:4319:4319 stint          the replay, no keys
#   STINT_REPO=/path/to/repo docker compose up -d         Stint on a repository of yours
# docs/docker.md is the guide.

# The tag says which Bun; the digest pins the multi-arch image, so a rebuild gets the same base (D-097).
ARG BUN_IMAGE=oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4

# JavaScript is the same on every architecture, so both build stages run once on the builder's own platform
FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS web
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build:web

# only what the stint command runs on; the web app's packages build the UI above and stay behind
FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS app
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production --filter @stint-dev/cli

FROM ${BUN_IMAGE}
# git for worktrees and merges; tini so the daemon gets signals and the agents it starts are reaped
RUN apt-get update \
 && apt-get install -y --no-install-recommends git tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system safe.directory '*' \
 && mkdir -p /home/stint /repo \
 && chmod 1777 /home/stint \
 && chown bun:bun /repo
COPY --from=app /app /app
COPY --from=web /app/apps/web/dist /app/apps/web/dist
RUN ln -s /app/packages/cli/bin/stint /usr/local/bin/stint

# HOME is writable by any user, so `--user "$(id -u):$(id -g)"` works on a bind-mounted repository
ENV HOME=/home/stint \
    STINT_BIND=0.0.0.0 \
    STINT_PORT=4319
USER bun
WORKDIR /repo
EXPOSE 4319

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.STINT_PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["tini", "--", "stint"]
CMD ["demo", "--keep"]
