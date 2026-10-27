# ADR-0006: Hand-offs and reviews cross harnesses while every model is Meta's

Status: Accepted, 27 Oct 2026 (with D-042). Specs: R-016 Req 3, R-035 Req 3.

## Context
R-016 Req 3 has the Hand to picker never recommend the leaving vendor, and R-035 refuses a reviewer of the same vendor. Under D-018 every model is Meta's, so a vendor rule would recommend nobody and refuse every review.

## Decision
The rule compares the harness and the model: the picker recommends a different agent from the one leaving, and a reviewer is refused only when it is the same harness on the same model as the implementer. When other vendors are enabled the same comparison holds, and the picker shows each agent's vendor, role and capability note so a person can choose across vendors (R-051).

## Consequences
- The demo hands Muse Code's work to the Stint agent and has Glimmer review Spark's work, which is what the rule exists for.
- With other vendors on, "a different vendor" is visible in the picker rather than enforced.
