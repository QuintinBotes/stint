# Contributing to Stint

Thank you for helping. This page says how a change gets from your fork into `main`, and what every change has to pass on the way.

## Before you start

- For anything larger than a small fix, open an issue first and say what you want to change and why. It saves you work if the change does not fit.
- Read [`AGENTS.md`](AGENTS.md). Its non-negotiables apply to every change, by a person or an agent: the daemon is the only writer of `.stint/`, packets and never transcripts reach the next agent, the daemon runs verification, and nothing in the repository identifies a person beyond a GitHub handle.
- Specs live in [`specs/`](specs/), one per change, and [`PROGRESS.md`](PROGRESS.md) records what was built from each. A change that adds behaviour comes with its spec or with a line in an existing one.

## Set up

Follow [`docs/setup.md`](docs/setup.md). In short:

```bash
bash scripts/bootstrap.sh
bash scripts/install-cli.sh
stint doctor
```

## Make the change

1. Branch from `main`.
2. Write the test first. A test names the behaviour it checks in plain words.
3. Keep the change to one purpose. Unrelated clean-up goes in its own pull request.
4. Match the code around you: TypeScript strict, the formatting of the file you edit, and comments only where the code cannot say why.
5. Copy in the UI and the CLI is sentence case, in plain words, with no emoji. Errors say what went wrong and how to fix it.

## Check it

Every pull request runs these in CI on Linux and macOS. Run them before you push:

```bash
bash scripts/check.sh
bun run test:ui
```

`scripts/check.sh` runs the typecheck, the test suite, the identity guard and the web build, and passes only when every one exits 0. The identity guard fails on a real email address, an em or en dash, or a name on the maintainers' private list. If it reports a denylisted name, remove that name from your change; the report gives an entry number and never the name.

## Sign off every commit

Stint uses the [Developer Certificate of Origin](https://developercertificate.org/). By signing off you state that you wrote the change, or have the right to submit it, under the project's licence. Add the sign-off with `-s`:

```bash
git commit -s -m "Explain what changed and why"
```

This adds a `Signed-off-by:` line with your name and email; a GitHub noreply address is fine. CI refuses a pull request with an unsigned commit. To sign commits you already made, run `git rebase --signoff main` and push again with `--force-with-lease`.

## Open the pull request

- Fill in the template: what changed, why, how you tested it, and the spec it belongs to.
- Keep it in draft until the checks are green.
- A maintainer reviews every pull request; changes to `.github/` (the CI workflows), `scripts/` (the identity guard among them) and the run sandbox need a maintainer's review in particular. Pull requests from forks run CI after a maintainer approves the run.
- Pull requests are squash-merged, so the title becomes the commit subject on `main`.

## Reporting a security problem

Do not open a public issue. Follow [`SECURITY.md`](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under the project's [MIT licence](LICENSE).
