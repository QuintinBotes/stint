# R-001 · Repo and bootstrap

Day: 0 (26 Oct) · Owner: Q · Depends on: F-001 · Fallback: none needed · Cut: never

## Goal
A Bun workspace that is green on macOS and Linux from the first commit, with one script that takes a fresh clone to a running daemon and UI in under 90 seconds. Everything later builds on this skeleton; nothing later touches its shape.

## Context
Layout, pins and CI are in `AGENTS.md` sections 4 and 6. The hackathon write-up will quote "CI green on two OSes from the first commit".

## Requirements
1. MUST create the workspace: root `package.json` with `"workspaces": ["packages/*", "apps/*"]`, `bunfig.toml`, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), packages `core`, `daemon`, `adapters/muse-code`, `adapters/stint-agent`, `adapters/openai-compatible`, `cli`, and `apps/web` each with a `package.json` named `@stint-dev/<name>` (web is private) and an empty passing test.
2. MUST add root scripts: `typecheck` (`tsc -b`), `test` (`bun test`), `build:web`, `dev` (daemon + web in watch), `test:ui` (Playwright, may be a stub that exits 0 until R-007), `bootstrap` (`scripts/bootstrap.sh`).
3. MUST add `scripts/bootstrap.sh`: checks Bun ≥ 1.3.14, git ≥ 2.40, Ollama (optional, warns), runs `bun install --frozen-lockfile`, starts `ollama pull muse-glimmer:30b-mlx` in the background if Ollama exists, copies `.env.example` to `.env` if missing, prints which of `META_API_KEY`, the partner keys, Ollama are present and which adapters that enables, and runs `bun run dev` with the demo repo and the replay loaded (replay lands in R-006; until then prints the URL).
4. MUST add `scripts/guard-identity.mjs`: fails on any real email address (regex, allowlist `noreply@` and `example.com`), any em or en dash in `.md`, `.ts`, `.tsx`, `.json`, `.sh` files, and any line matching a configurable denylist in `scripts/guard-identity.denylist` (seeded with the author's surname and employer; the denylist file itself is gitignored and documented).
5. MUST add `.github/workflows/ci.yml` with matrix `ubuntu-latest`, `macos-latest`: install Bun (pinned), `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run build:web`, `node scripts/guard-identity.mjs`, and on Ubuntu `apt-get install -y bubblewrap` plus `muse --version` when `META_API_KEY` is present (allowed to be absent).
6. MUST add `.gitignore` entries for `.stint/worktrees/`, `.stint/cache/`, `.env`, `node_modules`, `dist`, `scripts/guard-identity.denylist`.
7. MUST copy this kit into the repo root (`AGENTS.md`, `GOAL.md`, `LOOP.md`, `REVIEW.md`, `PROGRESS.md`, `specs/`, `schemas/`, `scripts/loop.sh`, `scripts/gate.sh`).
8. SHOULD add `CHANGELOG.md` (Keep a Changelog, `Unreleased`) and `docs/README.md` placeholder index. No `LICENSE` until the human decides (D-pending).

## Interfaces
- `scripts/bootstrap.sh` exit codes: 0 ok, 2 missing Bun or git, 3 install failed.
- `node scripts/guard-identity.mjs [path]` exit 0 clean, 1 findings (printed as `file:line: reason`).

## Acceptance
1. `bun install && bun run typecheck && bun test` pass on a fresh clone: `packages/core/test/smoke.test.ts` and one smoke test per package.
2. CI workflow runs green on both OSes (first push).
3. `node scripts/guard-identity.mjs` exits 0 on the repo and exits 1 on a fixture file containing `someone at gmail.com`: `scripts/test/guard-identity.test.ts`.
4. `scripts/bootstrap.sh` on a clean machine without keys exits 0 and prints the three adapter lines with "unavailable: <reason>" where a key is missing.

## Verify
```
bun install --frozen-lockfile && bun run typecheck && bun test
node scripts/guard-identity.mjs
bash -n scripts/bootstrap.sh && bash scripts/bootstrap.sh --check-only
```

## Out of scope
Any product behaviour, UI, schemas (R-002), the daemon (R-004).

## Notes
Pin the Bun version in `package.json` `"packageManager"` and in CI. Keep `apps/web` as a Vite template for now; shadcn/ui, Tailwind 4 and the token CSS come in R-007. The denylist keeps the author's name out of the public tree; never commit it.
