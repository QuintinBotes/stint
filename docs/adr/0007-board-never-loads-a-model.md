# ADR-0007: A task card on Timing never makes a local model load

Status: Accepted, 27 October 2026. Spec: R-016 Req 6.

## Context
R-016 has the task cards on Timing (`/`) summarised by a local model when one is available. Ollama loads a model on first use; on a 32 GB machine, loading Muse Glimmer 30B took about nine minutes and evicted other models.

## Decision
A card asks only a local model that is already in memory (Ollama's `/api/ps`); a local server without that route has no load step and is asked. Hosted hosts are never used for cards. Without a loaded model the card keeps the last agent message and makes no call. Answers are cached per event seq.

## Consequences
- Opening Timing costs nothing and never slows the machine.
- `stint up` warms the reviewer's local model on purpose (R-054), and cards use it once it is loaded.
