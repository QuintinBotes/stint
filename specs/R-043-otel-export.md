# R-043 · OpenTelemetry export

Day: added 26 Oct from the factory review · Owner: Q · Depends on: R-011

## Goal
Traces that live only in Stint's own format cannot be used by Langfuse, Braintrust or other eval tools.

## Requirements
1. MUST export runs, model calls and tool calls as OpenTelemetry spans following the GenAI semantic conventions (`gen_ai.operation.name`, `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`), with the task as the trace, each run as a span, tool calls as child spans, and verification, review and eval results as span events and attributes.
2. MUST send OTLP/HTTP JSON to `config.otel.endpoint` with headers from `config.otel.headersEnv`, batched, never blocking a run; `stint otel export <task>` writes the spans to a file for offline import.

## Acceptance
1. `stint otel export T-0042` on the replay writes spans whose attributes carry model and token counts, one span per run and tool call: `packages/cli/test/otel.test.ts`.
2. With an endpoint configured, a run's end posts a batch to a fake collector: `packages/daemon/test/otel.test.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh
```
