# Traces in other tools

This page is for anyone who wants Stint's runs in a tracing or eval tool. Stint can send them to any OpenTelemetry collector: Langfuse, Braintrust, Honeycomb, Grafana Tempo or your own. Each task is a trace:

- The task is the root span.
- Each run is a span under it: `invoke_agent muse-code` for an agent, `chat muse-spark-1.3` for a planner or reviewer call.
- Each tool call is a span under its run: `execute_tool write_file`.

Attributes follow the GenAI semantic conventions:
- `gen_ai.operation.name`;
- `gen_ai.request.model` and `gen_ai.response.model`;
- `gen_ai.agent.name` and `gen_ai.tool.name`;
- `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`.

Stint adds its own as `stint.*`: the task, run, role, host, cost, how the run ended, and the packet it continued from.

The daemon's judgements go on the run's span as span events: `stint.verification`, `stint.review`, `stint.handoff`, `stint.refused` and `stint.fallback`. Merges, approvals, outcomes and eval results go on the task's span.

## Send them live

```json
"otel": { "endpoint": "http://localhost:4318", "headersEnv": "STINT_OTEL_HEADERS", "serviceName": "stint" }
```

The daemon posts OTLP/HTTP JSON to `<endpoint>/v1/traces`. It sends in batches, after each run ends, and never makes a run wait. A collector that is down costs a log line, not a run.

`headersEnv` names an environment variable holding headers in the `OTEL_EXPORTER_OTLP_HEADERS` form, such as `Authorization=Bearer%20abc`. The key stays in your environment, not in the config.

## Export one task

```bash
stint otel export T-0042 --out trace.json
```

This writes the task's whole trace as OTLP JSON, for tools that import a file.
