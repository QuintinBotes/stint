# R-059 · A README and a setup a stranger can follow

Day: 2 (28 Oct) · Owner: CC · Depends on: R-058 · Fallback: keep the README order and only add Install, Troubleshooting, and the key loading fix · Cut: never

## Goal
Someone who has never heard of the hackathon should get from clone to the replay in under two minutes, and from the replay to Stint running on their own repository in under fifteen, using the README alone. Every command the README shows is run by a test. Keys work wherever the person runs `stint`.

## Context
- `README.md` is 238 lines. The quick start is fine, but setup is spread across the README, `docs/support.md`, `docs/agents.md`, and the output of `scripts/bootstrap.sh`. Proof material (What is real, Benchmark, Meta models, Built during) sits between the reader and the setup steps.
- **Key loading bug.** The README tells the person to `cp .env.example .env` in the Stint checkout, then `cd /path/to/your/repo` and run `stint up`. Bun loads `.env` only from the current directory, and nothing in `packages/cli` or `packages/daemon` loads one from anywhere else. So the keys silently go missing in the person's own repository. Found by grepping for `.env`, `dotenv`, and `loadEnv`.
- `stint` is installed as a shell alias that the README asks the person to type. There is no install script.
- `stint up --check` (`packages/cli/src/up.ts`, `upReport`) and `bootstrap.sh --check-only` each check part of the setup. Nothing checks the person's own repository.
- `packages/core/test/docs.claims.test.ts` checks the README's numbers against their files, and `docs.writeup.test.ts` checks the write-up. A CI quickstart job replays the demo from a clean clone.

## Requirements
1. MUST restructure `README.md` into this order, at no more than 180 lines:
   1. The logo, the one-line tagline, one paragraph on what Stint is, and the task screenshot.
   2. "Three proofs" (keep as is).
   3. "Quick start". Three commands to the replay, the time CI measured, what the person will see, and how to stop it.
   4. "Install". A table of required and optional prerequisites with versions, the one-line CLI install (Requirement 2), and `stint doctor`.
   5. "Use it on your repository". Numbered steps, each showing its expected output in a short block:
      1. Init.
      2. Keys.
      3. `stint up`.
      4. New task.
      5. `stint run`.
      6. The gate.
      7. Approve.
   6. "Everyday commands". A table of at most 12 rows, each with the command and one line on what it does.
   7. "Agents and models". A minimal `config.json` that turns on one more agent, plus a link to `docs/agents.md`.
   8. "Troubleshooting". The eight most likely failures as symptom, cause, and the fix as a command. Draw them from `stint doctor` failures and the existing refusals:
      - `dirty_tree`;
      - `adapter_unavailable`;
      - Glimmer not pulled;
      - port in use;
      - a key loaded from nowhere;
      - Bun too old;
      - `muse` not logged in;
      - a partner host returning 403.
   9. "How it works". At most 10 lines, with links.
   10. Links to the docs index, the licence, and the attribution line.
2. MUST move the long proof material out of the README:
   - "What is real", the benchmark narrative, the Meta models table, and "Built during the hackathon" go to a new `docs/proofs.md`. The README keeps one line and a link for each.
   - The detailed factory list goes to `docs/factory.md`.
   - `docs.claims.test.ts` follows the numbers to their new file, so every claim is still checked.
3. MUST add `scripts/install-cli.sh [--dir <bin dir>] [--uninstall]`:
   - It writes a shim `stint` into `$STINT_BIN_DIR`, else `--dir`, else `~/.local/bin`. The shim runs `exec bun "<checkout>/packages/cli/bin/stint" "$@"`.
   - It is idempotent.
   - It says when the directory is not on `PATH` and prints the line to add.
   - `--uninstall` removes only a shim it wrote, identified by a marker comment.
   - `bootstrap.sh` prints the install command just before it starts the replay.
4. MUST fix key loading in one shared function used by the CLI and the daemon (`loadKeys(repoRoot)` in `@stint-dev/core/node`). It loads each known key and every `keyEnv` named in config, in this order, first found wins:
   1. The process environment.
   2. `<repo>/.env`, only when git ignores it. If `.env` is tracked or not ignored, it is refused with a stderr line and a doctor failure, never read.
   3. `$XDG_CONFIG_HOME/stint/env`, default `~/.config/stint/env`. If its mode is wider than `0600`, it prints a warning.
   4. `<stint checkout>/.env`, for people who followed the old README. It prints a deprecation note naming the user-level file.
   Values never reach a log, an event, or the UI. Only names and sources do.
5. SHOULD add `stint keys set <NAME>`. It reads the value from stdin with no echo when stdin is a TTY, writes the user-level env file with mode `0600`, and refuses names that are not known keys or configured `keyEnv`s. Add `stint keys list`, which prints each name, its source, and whether it is set.
6. MUST add `stint doctor [--json] [--repo <path>]`. It prints one report with a line per check: `ok`, `warn`, or `fail`, the reason, and the fix as one command.
   - Bun and git versions.
   - `stint` on `PATH`, and whether it points at this checkout.
   - The daemon: reachable or not running.
   - The repository:
     - it is a git repository;
     - it has commits;
     - the tree is clean, or which tracked files are dirty;
     - `.stint/` is initialised;
     - `.env` is ignored.
   - Each key's source.
   - Each enabled agent: available, or why not.
   - Local models: Ollama reachable, and the configured reviewer model pulled.
   - The sandbox backend.
   It exits 0 when no line fails. It reuses `upReport`, adapter health, and the bootstrap checks rather than duplicating them. `bootstrap.sh --check-only` calls it once the CLI is installed.
7. MUST add `docs/setup.md`, the full guide, and make `docs/support.md` a short page that links to it. It covers:
   - platforms;
   - install;
   - where keys load from and in what order;
   - the first task on your own repository;
   - turning on Claude Code, Codex, and ACP agents (link to `docs/agents.md`);
   - the offline review;
   - updating (`git pull && bun install`);
   - uninstalling: the shim, `.stint/`, worktrees, `stint/*` branches, the user env file, and the Muse plugin.
8. MUST run every shell block in the README and `docs/setup.md` in a test, or mark why not.
   - A block that needs a key or a model is preceded by `<!-- needs: META_API_KEY -->` (or the model name). The test skips it and prints the reason.
   - The other blocks run in a temporary `HOME` against a fresh copy of the repository and the fixture, using the fake agents from `apps/web/e2e/flows/serve.ts` (the `writer` adapters and the fake ACP agent), as far as the gate.
   - A command in a block that the test cannot find in the CLI's command list fails the test.
9. MUST check that every relative link and image in the README and `docs/` resolves. A broken link fails the test.
10. MUST remove the `bun x @stint-dev/cli demo` line until the package is published.

## Interfaces
- `scripts/install-cli.sh [--dir <path>] [--uninstall]`.
- `stint doctor [--json] [--repo <path>]`. The JSON output is `{ checks: [{ id, status: 'ok'|'warn'|'fail', reason, fix?: string }], ok: boolean }`.
- `stint keys set <NAME>` and `stint keys list [--json]`.
- `loadKeys(repoRoot: string, opts?: { checkout?: string; env?: NodeJS.ProcessEnv }): { values: Record<string,string>; sources: Record<string, 'env'|'repo'|'user'|'checkout'|'missing'>; refusals: string[] }`.
- New files: `docs/setup.md`, `docs/proofs.md`, and `docs/factory.md`.

## Acceptance
1. `README.md` has the ten sections in order, under their exact names, in at most 180 lines. Test: `packages/core/test/readme.structure.test.ts`.
2. Every shell block in the README and `docs/setup.md` runs, or is skipped with its `needs` reason. A made-up command in a block fails the test. Test: `packages/cli/test/readme.commands.test.ts`.
3. Every relative link and image resolves. Test: `packages/core/test/docs.links.test.ts`.
4. With `META_API_KEY` only in the user-level env file, `stint up --check`, run from another repository, reports it with source `user`. A tracked `.env` is refused and never read. A `0644` user file warns. Test: `packages/core/test/keys.load.test.ts`.
5. `stint doctor --json` on a dirty fixture with no daemon fails `repo.clean` and `daemon`, warns `ollama`, and exits 1. On a clean fixture with the daemon up and fake agents, it exits 0. Test: `packages/cli/test/doctor.test.ts`.
6. `install-cli.sh --dir <tmp>` writes the shim, a second run changes nothing, the shim runs `stint --help`, and `--uninstall` removes it. A file at that path that the script did not write is left alone. Test: `scripts/test/install-cli.test.ts`.
7. `docs.claims.test.ts` passes with the numbers in their new file.

## Verify
```
bun test packages/core packages/cli scripts/test
bun run typecheck
test "$(wc -l < README.md)" -le 180
bash scripts/install-cli.sh --dir "$(mktemp -d)"
./packages/cli/bin/stint doctor --repo demo/repo --json | head -c 400
```

## Out of scope
Publishing to npm, Homebrew, Windows support, and a GUI installer.

## Notes
- Write for a reader who has never seen the hackathon, the build kit, or the demo. Use the repository's copy rules: sentence case, plain words, present tense, no em dashes.
- The quick start time in the README must be the number the CI quickstart job measures. Have the job print it, and have the claims test read it.
- Keep the three proofs table where it is. It is the first thing a judge reads, and the setup sections come straight after it.
