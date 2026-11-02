# ADR-0012: In a container the daemon listens on the container's network, published on the host's 127.0.0.1 only

Status: Accepted, 2 November 2026. Spec: R-004 Req 1 (deviation), R-001.

## Context
The owner asked for Stint to be self-hostable in a container. R-004 starts the daemon on 127.0.0.1 only, and the web page it serves carries the daemon's token, so whoever can open the page can start agents that write to the repository. A port that Docker publishes from a container reaches only a server that listens on the container's network, not on the container's loopback. So a daemon that keeps R-004's line exactly cannot be reached from the host at all.

## Decision
`stint up` and `stint demo` take `--bind`, or `STINT_BIND`, for the address the daemon listens on. The default stays 127.0.0.1. Only an IP address is taken, so a name cannot resolve somewhere unexpected, and every start beyond loopback prints a warning on stderr. The container image sets `STINT_BIND=0.0.0.0`, and `compose.yaml` publishes the port on the host's 127.0.0.1 only. The daemon's other defences stay as they were: it answers only to localhost names, so DNS rebinding cannot reach it, and every change needs the token. The client URL stays `http://127.0.0.1:<port>`.

## Consequences
- From the host, the daemon is reachable on loopback only, as it is when it runs on the machine.
- Inside Docker, the container's network becomes the boundary: another container on the same network could read the page and its token. `compose.yaml` gives Stint a network of its own, and `docs/docker.md` says never to publish the port beyond 127.0.0.1 or share the network.
- The `docker` run sandbox is not available to a daemon in a container: the image holds no Docker, and mounting the Docker socket would hand the container the host's Docker. A run that asks for it is refused, as before.
- A shared or hosted Stint (Kubernetes, a public address) stays out of scope: the daemon has one token and no user accounts.
