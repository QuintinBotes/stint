# ADR-0010: Muse Code is available when its own login works

Status: Accepted, 27 Oct 2026. Spec: R-009 Req 1.

## Context
R-009 has Muse Code's `available()` check `META_API_KEY`. Muse Code logs in by itself (`muse login`, its subscription), and the run environment strips every `_KEY` variable the agent does not need (R-040).

## Decision
`available()` checks that the `muse` CLI runs and reports its version; a run that cannot authenticate fails with Muse's own message on the timeline.

## Consequences
- A person on a Muse subscription needs no Meta API key to build with Muse Code.
