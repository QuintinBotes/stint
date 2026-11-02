# Running Stint in a container

This page is for anyone who wants Stint without installing Bun on their machine, or who keeps tools in containers. It covers the replay with no keys, Stint on your own repository with Docker Compose, the settings, what runs inside the container and what does not, how the container is kept safe, updating, and troubleshooting.

You need Docker with Compose 2.24 or later, and on Linux Docker Engine 28 or later: earlier engines let other machines on your local network reach a port published on 127.0.0.1. Nothing else is installed on your machine.

## The replay, with no keys

Run the published image; there is nothing to clone or build:

```bash
docker run --rm -p 127.0.0.1:4319:4319 ghcr.io/quintinbotes/stint
```

Open http://127.0.0.1:4319. The container replays the recorded story through the real daemon, as `bash scripts/bootstrap.sh` does, then keeps the UI up until you press Ctrl-C. To build the image from a clone of this repository instead, run `docker build -t stint .` and use `stint` in place of the image name.

## Stint on your repository

Compose runs `stint up` on a repository you mount, keeps it running across restarts, and stops it gently.

1. Copy the example settings and fill them in. `STINT_REPO` is the repository Stint works on; the keys are the ones [`setup.md`](setup.md#keys) describes.

   ```bash
   cp .env.example .env
   ```

2. Get the image, start it, and follow its log. `docker compose pull` fetches the published image; `docker compose build` makes it from this checkout instead.

   ```bash
   docker compose pull
   docker compose up -d
   docker compose logs -f stint
   ```

3. Open http://127.0.0.1:4319. Stint keeps its state in `.stint/` inside your repository, exactly as when it runs on your machine.

4. Stop it with `docker compose down`. The daemon gives runs that are ending up to 10 seconds to commit, verify and write their packet, and Compose waits 20.

Run any `stint` command inside the container with `docker compose exec`, for example `docker compose exec stint stint watch`.

On Linux, the container must run as the user who owns the repository, or the daemon cannot write `.stint/`. Set `STINT_UID` and `STINT_GID` in `.env` to what `id -u` and `id -g` print. Docker Desktop and OrbStack on macOS need no setting.

## Settings

Compose reads these from `.env` beside `compose.yaml`.

| Setting | Default | What it does |
|---|---|---|
| `STINT_REPO` | none, required | The repository Stint works on, mounted at `/repo` |
| `STINT_HOST_PORT` | `4319` | The port on this machine's 127.0.0.1 |
| `STINT_IMAGE` | `ghcr.io/quintinbotes/stint:latest` | The image Compose runs; a `sha-` tag stays on one build |
| `STINT_UID`, `STINT_GID` | `1000` | The user the container runs as; on Linux, the repository owner's |
| `META_API_KEY` and the partner keys | none | The hosted models, as in [`setup.md`](setup.md#keys); a `.env` in your repository works too |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` | none | Who the merges are by; without them the daemon signs its merges "Stint daemon" |

The image sets `STINT_BIND=0.0.0.0` and `STINT_PORT=4319` itself, so the published port reaches the daemon. Leave them as they are, and change the port with `STINT_HOST_PORT`, not with `--port`: the health check probes `STINT_PORT`. [Security](#security) says why the port is published on 127.0.0.1 only.

## What runs in the container

- The daemon, the `stint` command line and the web UI.
- The Stint agent, planning and review on the hosted Meta models: the Meta Model API, and Muse Spark Open on Baseten, Fireworks and Modal.
- The offline review, with Ollama running on your machine. In `.stint/config.json`, which Stint writes on its first start, set `hosts.ollama.baseURL` to `http://host.docker.internal:11434/v1`. On Linux, Ollama listens on 127.0.0.1 only unless you start it with `OLLAMA_HOST=0.0.0.0`.

Not in the image:

- **Muse Code, Claude Code and Codex.** Their command lines are not installed, so the status menu lists them as unavailable and says why. To use one, build an image on top of this one that installs it, or run Stint on your machine.
- **The `docker` run sandbox.** The image holds no Docker, and `compose.yaml` does not mount the Docker socket, because that would give the container control of every container on your machine. A run that asks for the `docker` sandbox is refused with the reason, as [`sandbox.md`](sandbox.md) describes.

## Security

The web page carries the daemon's token, so anyone who can open the page can do what you can: start agents that write to your repository. On your machine the daemon listens on 127.0.0.1 alone. In the container it listens on the container's own network, so that Docker can forward the port, and `compose.yaml` publishes that port on your machine's 127.0.0.1 only. Keep it that way:

- Do not publish the port on `0.0.0.0` or put the container on a network shared with other containers.
- To reach Stint from another machine, use an SSH tunnel to the one that runs it: `ssh -L 4319:127.0.0.1:4319 your-host`.
- The daemon still answers only to localhost names, so a web page elsewhere cannot rebind DNS onto it, and every change still needs the token.
- `docker run` puts the replay on Docker's default network, which other containers share. The replay holds only the demo repository, so nothing of yours is within reach. Stint on your repository runs on a network Compose makes for it alone.

`compose.yaml` also runs the container as a user who is not root, with a read-only filesystem apart from `/repo`, `/tmp` and its home, with no Linux capabilities, and with no way to gain privileges. Keys reach the container as environment variables at start; `.dockerignore` keeps `.env` out of the image.

A shared Stint, on Kubernetes or behind a public address, is not supported: Stint is one person's daemon on one repository, with one token and no user accounts.

## Updating

Pull the new version and restart:

```bash
git pull
docker compose pull
docker compose up -d
```

Every push to `main` that passes the smoke test publishes the image for amd64 and arm64, tagged `latest` and `sha-` with the commit. To run what you changed in this checkout, use `docker compose build` in place of `docker compose pull`. The image starts from a Bun image pinned by digest in `Dockerfile`, so a rebuild changes only what changed in Stint.

## Moving between the container and your machine

Git records each run's worktree by its path, which is under `/repo` in the container. Stop runs before you move a repository from the container to Stint on your machine, or back, and then run `git worktree prune` in the repository to forget worktrees at paths that no longer exist.

## Troubleshooting

| What you see | Why | What to do |
|---|---|---|
| `required variable STINT_REPO is missing a value` | Compose needs the repository for every command | Set `STINT_REPO` in `.env` beside `compose.yaml` |
| The daemon stops with a permission error on `.stint/` | On Linux, the container runs as a user who does not own the repository | Set `STINT_UID` and `STINT_GID` to what `id -u` and `id -g` print |
| `docker compose up` says the port is in use | Another program has 4319 | Set `STINT_HOST_PORT` in `.env` |
| The review host is unreachable | The container's `localhost` is the container, not your machine | Set `hosts.ollama.baseURL` as [above](#what-runs-in-the-container) |
| Muse Code, Claude Code or Codex is unavailable | Their command lines are not in the image | Build on this image to add one, or run Stint on your machine |
| Tasks fail to make their worktrees | `STINT_REPO` is a linked worktree (`git worktree add`), whose `.git` points outside the mount | Point `STINT_REPO` at the repository's main checkout |
| The container stays `unhealthy` | The daemon did not start, or its port was changed with `--port` | `docker compose logs stint` prints why; change the port with `STINT_HOST_PORT` |

## Checking the image

`bash scripts/docker-smoke.sh` builds nothing; it takes an image you built with `docker build -t stint:local .` and checks it does what this page says. It runs the replay and checks the UI, the API, and the refusal of another Host and of a change without the token. Then it runs `stint up` on a throwaway repository as your user, with the same restrictions `compose.yaml` sets, and checks that `docker stop` ends each one cleanly. CI runs it on every pull request that touches the image, and publishes the image only after it passes.
