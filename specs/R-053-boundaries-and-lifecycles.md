# R-053 · Boundaries an agent cannot cross, and lifecycles that close

Day: added 27 Oct from the requirements audit · Owner: Q (security boundary) · Depends on: R-003, R-004, R-008, R-013 · Fallback: requirements 1 to 3 · Cut order: never

## Goal
Make the refusals the Stint agent relies on hold against chained commands, global git flags, absolute paths and symlinks; keep every write under `.stint/` atomic and in one place; register agents from config and check them at start; close terminals with their worktrees.

## Context
The Stint agent's refusals are `packages/adapters/stint-agent/src/refusals.ts` (`checkCommand`, `checkPath`). An audit ran `git checkout main && ls`, `git switch x; ls`, `git -C . push origin` and `cat /etc/hosts` through `checkCommand` and all were allowed; `checkPath` does not resolve symlinks. Raw writes under `.stint/`: `routes/models.ts` (`plan.md`, queue files), `risk.ts` (config toggle), `cli/src/otel.ts` (export file). Adapters are registered in `packages/daemon/src/server.ts` without reading `adapters.<id>.enabled`. PTYs live in `packages/daemon/src/pty.ts` and `routes/pty.ts`; `Worktrees.remove` does not close them.

## Requirements
1. MUST evaluate every command in a chain (`&&`, `||`, `;`, `|`, newlines, `$(…)` and backticks) and refuse the whole command when any part is refused.
2. MUST refuse git commands that change branch or remote state (`checkout` or `switch` of another branch, `push`, `remote add`, `reset --hard` outside the worktree's branch, `branch -D`) wherever global flags (`-C path`, `-c k=v`, `--git-dir`) appear before the subcommand.
3. MUST refuse a shell command naming an absolute path or a `..` path that resolves outside the worktree, apart from a short allow list of read-only system paths a build needs (`/dev/null`, `/usr/bin/env`, `/tmp` under the run's temp directory); and MUST resolve symlinks in `checkPath`, so a link inside the worktree cannot reach a file outside it.
4. MUST write every file under `.stint/` through the store's atomic writers with stable key order: `plan.md`, the auto-approve config toggle (through a `Workspace.writeConfig`), the queue files, the stored scenarios, the sandbox log offset and `daemon.json` (created 0600 before it holds the token). The CLI writes nothing under `.stint/`: `stint otel export` writes `./<task>.otel.json` beside the person, as `stint export` writes its zip.
5. MUST register only enabled adapters from `adapters.<id>.enabled` (default true for the three built in), report the flag in health, and call each adapter's `available()` once at start so the first health read is warm.
6. MUST close a task's PTYs when its worktree is removed, allow one PTY per task per client (a second open from the same client replaces the first), and label the kill button "Kill run" with the shortcut ⌘. bound in the terminal tab.
7. MUST write each tool's output into the Stint agent's run transcript beside the model responses.

## Interfaces
- `Workspace.writeConfig(patch)`: atomic, validated, stable key order.

## Acceptance
1. Each of the audit's bypasses, and a symlink pointing outside the worktree, is refused with a reason: `packages/adapters/stint-agent/test/refusals.test.ts`.
2. Every raw file write in the daemon, CLI and adapter sources is on a list with its reason, so a new raw write under `.stint/` fails; `writeConfig` sorts keys and refuses an invalid edit without changing the file: `packages/daemon/test/store.writes.test.ts`.
3. An adapter disabled in config is not registered and health says so; health's first read does not call `available()` again: `packages/daemon/test/health.test.ts`.
4. Removing a worktree closes its PTY; a second socket from the same client replaces the first: `packages/daemon/test/pty.test.ts`.
5. ⌘. kills the live run from the terminal tab and the button reads "Kill run": `apps/web/e2e/flows/kill-and-hand.spec.ts`.
6. A Stint agent run's transcript holds its tool outputs: `packages/adapters/stint-agent/test/transcript.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh && bun run test:ui
```

## Out of scope
A full shell parser; sandboxing (R-040 covers it).

## Notes
The refusals are a second line behind the sandbox (R-040), not a replacement for it. Splitting on shell operators errs toward refusing: a quoted operator in an argument may refuse a harmless command, and the reason says which part.
