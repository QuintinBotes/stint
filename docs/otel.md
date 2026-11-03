# Traces in other tools

This page explains how to send Stint's runs to a tracing or eval tool. Stint sends them to any OpenTelemetry collector: Langfuse, Braintrust, Honeycomb, Grafana Tempo or your own.

Each task is a trace:

- The task is the root span.
- Each run is a span under it: `invoke_agent muse-code` for an agent, `chat muse-wonder-1.0` for a planner call or `chat muse-glimmer:30b-mlx` for a review.
- Each tool call is a span under its run: `execute_tool write_file`.

Attributes follow the GenAI semantic conventions:

- `gen_ai.operation.name`;
- `gen_ai.request.model` and `gen_ai.response.model`;
- `gen_ai.agent.name` and `gen_ai.tool.name`;
- `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`.

Stint adds its own attributes as `stint.*`: the task, run, role, host, cost, how the run ended, and the packet it continued from.

The daemon's judgements go on the run's span as span events: `stint.verification`, `stint.review`, `stint.handoff`, `stint.refused` and `stint.fallback`. Merges, approvals, outcomes and eval results go on the task's span.

## Send them live

```json
"otel": { "endpoint": "http://localhost:4318", "headersEnv": "STINT_OTEL_HEADERS", "serviceName": "stint" }
```

The daemon posts OTLP/HTTP JSON to `<endpoint>/v1/traces`. It sends in batches after each run ends, and never makes a run wait. A collector that is down costs a log line, not a run.

`headersEnv` names an environment variable that holds headers in the `OTEL_EXPORTER_OTLP_HEADERS` form, such as `Authorization=Bearer%20abc`. The key stays in your environment, not in the config, and Stint keeps that variable out of every agent's and test run's environment, as it does the hosts' keys ([`sandbox.md`](sandbox.md#keys-stay-in-the-daemon)).

## Export one task

```bash
stint otel export T-0042 --out trace.json
```

This writes the task's whole trace as OTLP JSON, for tools that import a file. Without `--out` it goes to `./T-0042.otel.json`. `stint otel export --metrics` writes the workspace metrics as gauge points instead, to `./metrics.otel.json`.
