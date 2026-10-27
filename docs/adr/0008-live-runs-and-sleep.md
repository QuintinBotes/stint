# ADR-0008: Live runs hold off idle sleep; caps count awake time

Status: Accepted, 27 Oct 2026. Specs: R-005, R-021, R-022, R-046.

## Context
The first live golden eval lost two of nine tries to a laptop that slept: the network dropped under the agent, and the verifier's ten-minute timer fired on waking after 0.6 s of test time.

## Decision
- The test cap counts time the machine was awake: a timer that fires while the monotonic clock stood still is set again for the time still owed.
- `stint eval`, `stint bench` and `stint demo --live` run `caffeinate -i` on macOS for their own lifetime.

## Consequences
- A closed lid still sleeps the machine; the docs say to keep it open and on power for live runs.
- A zero-token run or a sub-second timeout in a live result is checked against the power log before it is blamed on the agent.
