# ADR-0002: The interfaces that changed from their specs during the build

Status: Accepted, 27 Oct 2026. Specs: R-004, R-005, R-027, R-035, R-041.

## Context
A requirements audit on 27 Oct found interfaces that work but no longer match their spec lines. Each change was made for a reason at the time and is covered by tests; none was recorded as a deviation.

## Decision
Keep each of these, and record it here and in the PROGRESS Deviations table:

| Spec line | As written | As built | Why |
|---|---|---|---|
| R-004 Interfaces | `createApp(ws, adapters)` | `createApp(ws, adapters, options)` | The token that guards every mutating route is an option; a default would mean a daemon without one |
| R-005 Interfaces | `verify(task, run)` | `verify(task, run, worktree)` | Best of n, checkpoints and the evals verify worktrees that are not the run's default path |
| R-027 Req 4 | `acceptance.tampered` | `verification.tampered` | R-029 made the tamper check part of verification; one event for one check |
| R-035 Req 2 | candidates on `stint/<task>-b<k>` | child tasks on their own `stint/T-xxxx` branches (D-043) | One task holds one live run; a child task gives each candidate its own timeline, verification and cost |
| R-041 Req 1 | `stint intake github --repo owner/name` | `--gh-repo owner/name` | `--repo` already names the local workspace on every Stint command |

## Consequences
- The specs keep their original lines; this file and the Deviations rows say what is true.
- R-025's autopilot response gains the `step` field its interface names (R-054), since that costs nothing to add.
