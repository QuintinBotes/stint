# R-058 · No client or employer names, and a guard that proves it in CI

Day: 2 (28 Oct) · Owner: CC · Depends on: none · Fallback: the plain-text scrub without the keyed denylist · Cut: never

## Goal
The public repository names no client, client platform or employer of the author, and CI keeps it that way without the repository spelling the names out. Today the scrub depends on a gitignored denylist, so CI prints "names were NOT checked" and four tracked places name a client platform. This spec removes them, makes the guard enforceable in CI with a keyed hash list, and cleans the docs of references to documents that are not in the repository.

## Context
- `scripts/guard-identity.mjs` checks emails, em and en dashes, and the words in the gitignored `scripts/guard-identity.denylist`. With no denylist it warns and exits 0. Its test is `scripts/test/guard-identity.test.ts`.
- Non-negotiable 9 in `AGENTS.md` and LOOP.md section 5 forbid client and employer names.
- As of commit `db1ef1a`, the client platform is named in four places. Find them with `grep -rniI "open-source agent factory" .`:
  - `README.md`, section "Ideas borrowed";
  - the `PROGRESS.md` R-027 Notes cell;
  - `PROGRESS.md` decisions D-036 and D-037.
- The same name appears in 5 commit messages and 27 diff lines of history. History is the person's decision (Requirement 10).
- The `By` column of decisions D-001 to D-006 uses the author's first name. Later rows use `author`.
- Some spec Context lines point at documents that are not in the repository:
  - "the spec doc" in R-004, R-005, R-009, R-017, R-018, R-023, and R-024;
  - "artboard" and "wireframe" in R-015, R-016, and R-019;
  - "the kit's `design/` folder" in R-007.
- `docs/README.md` still says files "arrive in R-002" and "arrive in R-023".
- The author's earlier private terminal project is named in 9 specs, in a comment in `packages/core/src/store/eventlog.ts`, and in D-004.

## Requirements
1. MUST remove every mention of the client platform from tracked files. Where the text credits an idea, keep the credit honest without the name: "re-implemented from earlier work on agent factories; no code was taken". Delete the README section "Ideas borrowed" and put that one sentence under "How it is built".
2. MUST change the `By` cell of D-001 to D-006 to `author`. Add decision D-0xx: "Attribution in D-001 to D-006 normalised to `author`; content unchanged", with the reason "non-negotiable 9".
3. MUST add a keyed hash list, `scripts/guard-identity.denylist.hmac`, and commit it.
   - Each line holds one lowercase hex HMAC-SHA256 of a normalised name, optionally followed by `  # <label>`. The label never contains the name (for example `# client 1`).
   - The key comes from the environment variable `STINT_GUARD_KEY`. Locally it is set in `.env` or the shell; in CI it is a repository secret.
4. MUST make the guard check each line against the keyed list:
   - Normalise the line: Unicode NFKC, then lowercase.
   - Split it into tokens on every character that is not a letter or a digit.
   - Hash each token, each pair of adjacent tokens joined by one space, and each pair joined with nothing. So `Acme`, `ac-me`, `AC ME`, and `ac:me` all match an entry made from `acme`.
   - A hit prints `<file>:<line>: denylisted name (entry <n>)` and never echoes the matched text.
   - The plain gitignored denylist keeps working beside the keyed list.
5. MUST add `scripts/denylist-hash.mjs`.
   - It reads one name from stdin, normalises it the same way, and prints the line to append. Use it like this: `printf %s 'name' | node scripts/denylist-hash.mjs >> scripts/guard-identity.denylist.hmac`.
   - It refuses to run without `STINT_GUARD_KEY`.
   - It never takes the name as an argument, so the name stays out of shell history.
6. MUST fail loudly when the guard cannot check names:
   - Locally, with no key and no plain denylist, the guard prints "names were NOT checked" on stderr and exits 0, as it does today.
   - With `CI=true` it exits 1 unless the key is set and the keyed list has at least one entry.
7. MUST add `--commits <range>`. It runs the same rules over `git log --format=%B <range>`, and a finding reads `<sha>: denylisted name (entry <n>)`.
   - CI runs it on pull requests over `origin/main..HEAD`.
   - On a push to main, CI runs it over `${{ github.event.before }}..${{ github.sha }}`. When `before` is all zeros, it covers only the pushed commit.
8. MUST replace every reference to a document that is not in the repository with the file that holds the same content today, or remove the clause.
   - "the spec doc's Daemon API" becomes "`AGENTS.md` section 5 and `docs/agents.md`". Point the other "spec doc" references at their real homes the same way.
   - "artboard" and "wireframe" references become the component name and `design/tokens.json`.
   - "the kit" becomes "the build kit (`AGENTS.md`, `GOAL.md`, `LOOP.md`, `specs/`)".
   - This is the only edit to `specs/` this spec allows, and it changes Context lines only. Requirements, Interfaces, and Acceptance stay byte for byte.
9. SHOULD replace the name of the author's earlier terminal project with "an earlier terminal project" in the specs, the eventlog comment, and D-004, unless the person says to keep it. Ask once under Blocked and continue with the rest.
10. MUST NOT rewrite git history. Write one Blocked row asking the person whether to rewrite it. The row gives the counts and the command that reproduces them (`git log --all --format=%B | grep -ci "<name>"` and `git log --all -p | grep -ci "<name>"`) and nothing else.
11. MUST rewrite `docs/README.md` as an index of every file in `docs/` and `docs/adr/`, one line each, saying what the file is for, with no "arrives in" lines.

## Interfaces
- `node scripts/guard-identity.mjs [path] [--commits <range>]`. Exit codes stay the same: 0 clean, 1 findings.
- `printf %s '<name>' | node scripts/denylist-hash.mjs` prints `<hex>  # <label>` when `--label <label>` is given, and `<hex>` otherwise.
- The file `scripts/guard-identity.denylist.hmac` is committed. `scripts/guard-identity.denylist` stays gitignored.
- The variable `STINT_GUARD_KEY` is added to `.env.example` with an empty value and a one-line comment.

## Acceptance
1. With a keyed entry for `acme`, the guard flags `Acme Corp`, `ACME`, `ac-me`, and `ac:me`. It does not flag `acmeist`, and its stdout and stderr never contain `acme` in any case. Test: `scripts/test/guard-identity.test.ts`.
2. `--commits` flags a commit message that contains `Globex` in a temporary repository with a keyed `globex` entry. Same file.
3. With `CI=true`, a missing key, and no plain denylist, the guard exits 1 and names the missing variable. Same file.
4. `grep -rniI "open-source agent factory" .` (excluding `node_modules` and `.git`) prints nothing. With the person's key and entries, `node scripts/guard-identity.mjs` exits 0. See Verify.
5. `docs/README.md` lists every file under `docs/` and nothing else. Test: `packages/core/test/docs.index.test.ts`.
6. No file under `specs/` contains "spec doc", "artboard", "wireframe", or "the kit's". Test: `packages/core/test/docs.references.test.ts`.

## Verify
```
node scripts/guard-identity.mjs
CI=true node scripts/guard-identity.mjs
node scripts/guard-identity.mjs --commits origin/main..HEAD
bun test scripts/test packages/core
bun run typecheck
```

## Out of scope
Rewriting history. The Meta, hackathon, and partner names, which are public and required. The licence.

## Notes
- Never write the client name, or any other name being scrubbed, into this spec, a test, a fixture, a commit message, `PROGRESS.md`, or a log line. Tests use invented names (`acme`, `globex`). The person adds the real entries with `denylist-hash.mjs`.
- A plain SHA-256 of a short word can be reversed with a dictionary, which is why the list is keyed. Without the key, the committed file reveals nothing.
- One of the names is also an ordinary English word. The guard matches whole tokens only, so a longer word that contains it passes. Do not use the bare word in any sense in tracked text.
- Set the `STINT_GUARD_KEY` secret in the GitHub repository before merging. Otherwise the CI change turns main red, so write it under Blocked as a human to-do first.
