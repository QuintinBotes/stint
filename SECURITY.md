# Security policy

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue, discussion or pull request for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it. You will get an answer within five working days, and a fix or a plan within thirty. When it is fixed, the advisory credits you unless you ask otherwise.

## Supported versions

Stint is pre-1.0. Only the latest commit on `main` receives security fixes.

## What is in scope

- The daemon: its routes, its token, the `.stint/` store it writes, and the worktrees and processes it starts.
- Anything that lets an agent act outside its worktree or its sandbox, read a key, or reach the network when the run's policy says it may not.
- Anything that puts a key, a credential or a transcript into a packet, an event, the UI or a log.
- The CLI, the web UI and the adapters in this repository.

Problems in a coding agent or a model host that Stint drives belong with that project, unless Stint's handling makes them worse.
