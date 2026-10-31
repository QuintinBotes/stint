# ADR-0011: The default replay stays hand-written until a network-off live take exists

Status: Accepted, 27 October 2026; closed by the owner on 31 October 2026, with the decision kept. Spec: R-022 Req 3 and 4.

## Context
R-022 makes the live recording the default replay. The live takes so far ran the review with the network on, and in one the learn step had nothing to propose, so promoting a take would lose the offline-review and learned-skill beats the story needs.

## Decision
`demo/recording.jsonl` stays the hand-written story, labelled "Replay, hand-written" on screen. Live takes are kept in `demo/recordings/`. When the owner records a take with the network off at the review beat and a skill proposed, it becomes the default and this ADR is superseded.

## Consequences
- The replay is honest about being hand-written; the README says which numbers are live.

## Closed, 31 October 2026
The network-off take was recorded on 30 October, and every live take since has reviewed on the laptop. No live take has proposed a skill: the learn step found no finding that recurred in a take. So the hand-written story stays the default replay, labelled as such on screen, and the live takes are in the film (`docs/video.md`) and the evidence (`docs/proofs.md`).
