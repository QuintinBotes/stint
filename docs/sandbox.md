# Sandbox and network

This page is for anyone who runs agents on code they care about: how Stint keeps keys, files and the network closed to an agent, and when it may approve a change on its own. A worktree keeps agents from writing over each other. It doesn't stop an agent from writing elsewhere, or from sending your code to any host on the internet. A prompt injection in a README, plus network access, is all an attacker needs. Stint has three layers for this. Two are off by default.

## Keys stay in the daemon

This one is always on. Nothing an agent or a test run starts gets a variable whose name ends in `_KEY`, `_TOKEN`, `_SECRET` or `_PASSWORD`. The model hosts' keys stay in the daemon, which makes the model calls itself. An agent that needs its own key names it in its entry under `agents`:

```json
"agents": { "my-agent": { "command": ["my-agent", "--json"], "prompt": "stdin", "roles": ["implementer"], "vendor": "other", "env": ["MY_AGENT_API_KEY"], "enabled": true } }
```

Muse Code keeps its login in `~/.config/muse`, so it needs no variable. The terminal in the UI is your own shell and keeps your variables.

What you type in that terminal and what an agent's tools print can still hold a secret, so both are scrubbed before they reach the event log, by the same scrubber the packet uses. The value after a name like `API_KEY=` or `API_KEY:` (any name containing `KEY`, `TOKEN`, `SECRET` or `PASSWORD`) becomes `[redacted]`, and so does the value of every key Stint loaded, wherever it appears.

## Egress: allowed hosts only

```json
"sandbox": { "kind": "none", "egress": { "mode": "proxy", "allow": ["*.github.com"] } }
```

With `mode: "proxy"`, the daemon runs a proxy on 127.0.0.1 and sets `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` for every agent and test run. The proxy lets a connection through only to:

- the hosts of the models in `hosts`;
- `registry.npmjs.org`;
- what `allow` adds. `*.example.com` covers the domain and every name under it.

Every other connection is refused, and the refusal is recorded as `rule.blocked` on the run that tried it. The next packet's refusals list carries it, so the next agent knows the network was closed.

On its own the proxy only covers tools that honour the proxy variables, which most do. `/api/health` says `enforced: false` in that case. To enforce it, add a sandbox.

## A sandbox per run

`sandbox.kind` picks the sandbox.

**`sandbox-exec`** (macOS) runs the agent under a profile.
- It can write only to:
  - its worktree;
  - the repository's `.git` (its commits land there), except its hooks and its config;
  - temp folders;
  - the usual agent state and cache folders in your home: `~/.config`, `~/.cache`, `~/.bun`, `~/.npm`, `~/Library/Application Support` and `~/Library/Caches`;
  - any paths in `sandbox.writable`.
- It cannot read `.stint/cache`, which holds the daemon's token.
- It can open network connections only to the egress proxy and the daemon.

**`docker`** runs the agent in a container.
- Only the worktree and the repository's `.git` are mounted, at the same paths as on your machine. The git hooks and config are mounted read-only, and `.stint/cache` is never mounted.
- With egress on, the container sits on an internal network (`stint-egress`) with no route out. Its only way out is a proxy sidecar, which applies the same allow list and logs refusals back onto the run.
- The image is `sandbox.image` (default `node:22`) and must contain the agent's command line.
- Hooks that call the daemon don't work from inside a container.

**`none`**, the default, runs agents as before.

If the configured sandbox can't run (docker not running, or `sandbox-exec` on Linux), Stint refuses the run and says why. It never quietly runs an agent outside the boundary you asked for.

The Stint agent's file tools run inside the daemon and are held to the worktree by its path checks. Its search runs in a separate worker that is stopped after 5 seconds, and a pattern over 500 characters, or one that is not a valid regular expression, comes back to the agent as a tool error, so no search can stall the daemon. Its shell commands run in the sandbox.

Whatever the sandbox:
- Each run gets its own token, `STINT_RUN_TOKEN`, with the daemon's port in `STINT_DAEMON_PORT`. The token reaches only the routes the agent's hooks and `stint mcp` call for that task and run, answers 403 anywhere else, and stops working when the run ends. Approving, merging and managing skills need the daemon token.
- The daemon runs git with hooks turned off, so a hook an agent wrote never runs outside its sandbox.
- The daemon's own test runs on the agent's code use the same sandbox as the agent.
- The keys of every configured host are kept out of a run's environment whatever they are called, and so is a base URL that carries a password or a key.

## Risk and the auto-approve lane

Every reviewed change gets a risk tier, shown on the approval gate with its reasons:
- **High:** it touches sensitive paths (access, payments, migrations, CI, the lockfile; `risk.highPaths` replaces the list), deletes or shrinks tests, changes over 400 lines, has security findings, or touched the locked tests.
- **Medium:** it touches more than 5 files, or an entry point, typings or schemas.
- **Low:** everything else.

Shadow mode is always on. Each time you approve, reject or ask for changes, Stint records what an auto-approve policy would have done. The Factory (`/factory`) shows the record per tier: how often it agreed with you, how often it didn't, and whether anything it would have approved was reverted later.

The lane that approves by policy is off. To turn it on, edit the config:

```json
"risk": { "highPaths": [], "autoApprove": { "enabled": true, "tiers": ["low"], "shadowDays": 14 } }
```

Even then it approves a change only when all of these hold:
- the change's tier is in `tiers`;
- the tests are green and every review approves;
- that tier's shadow record covers `shadowDays`, with at least three decisions, no disagreement in the window and no revert.

A policy approval goes through the same checks as yours, and is recorded as the policy's, never yours. The Factory has a button to turn the lane off. Turning it on is only ever an edit to the config.
