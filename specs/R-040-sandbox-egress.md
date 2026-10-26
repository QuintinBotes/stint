# R-040 · A sandbox per run and a default-deny egress proxy

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-005

## Goal
A worktree is not a boundary. Prompt injection plus network access is the lethal trifecta.

## Requirements
1. MUST run an egress proxy in the daemon (HTTP and HTTPS CONNECT on 127.0.0.1) allowing only `config.sandbox.egress.allow` hosts (defaults: the configured model hosts and the package registry), set as `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` for every agent and verify process when `egress.mode` is `proxy`; every refused connection emits `rule.blocked { by: 'egress' }`.
2. MUST strip credentials from agent environments (any `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`) unless the agent's manifest names the variable it needs; the model hosts' keys stay in the daemon.
3. MUST support `sandbox.kind`: `docker` runs the agent in a container with only the worktree mounted and the proxy as its only route; `sandbox-exec` (macOS) runs it under a profile that denies writes outside the worktree and network except the proxy; `none` keeps today's behaviour. Health reports which is active.

## Acceptance
1. A process in a run's environment can reach an allowed host through the proxy and is refused for another, with the event recorded: `packages/daemon/test/egress.test.ts`.
2. An agent's environment has no API keys unless its manifest names them: `packages/daemon/test/sandbox.env.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
