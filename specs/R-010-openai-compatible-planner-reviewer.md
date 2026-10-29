# R-010 · OpenAI-compatible planner and reviewer, four hosts

Day: 3 (29 Oct) · Owner: MC · Depends on: R-002 · Fallback: two hosts (Meta API and Ollama) if the partner keys are not claimed in time · Cut: never

## Goal
One client, four base URLs: Meta's Model API for `muse-wonder-1.0` plans, Baseten and Fireworks for Meta's open-weight `muse-spark-open`, and local Ollama for `muse-glimmer:30b-mlx` reviews, all returning validated `stint.plan/1` and `stint.review/1`. A host is a base URL and a key name, never a code path. The daemon walks a fallback chain per role, so a rate limit on the Meta API or a laptop that cannot run Glimmer never stops a task; the offline review at $0.00 and the contradiction routing live here; and every answer records which host gave it.

## Context
`openai` SDK 5.x. Hosts and prices are in `AGENTS.md` section 6. Meta's own deployment page lists Baseten and Fireworks as hosting partners for Muse Spark Open; both are hackathon partners (Baseten $100 credits and 2M TPM, Fireworks $25). Baseten's Model APIs accept `json_schema` for Muse Spark Open but do not enforce it; Fireworks enforces `json_schema` (grammar-constrained) and prices cached input at $0.15, which rewards the cache-stable prefix. Review prompt under 4k tokens; local model warmed before a run.

## Requirements
1. MUST implement `packages/adapters/openai-compatible/src/index.ts` exporting `makeHost({ id, baseURL, apiKeyEnv?, models: Record<role, string>, offline, structuredOutput: 'enforced' | 'accepted' | 'prompt-only', cachedInput: boolean })` and register four hosts from `config.json`: `meta-api`, `baseten`, `fireworks`, `ollama`, each exposing `available()` (`GET /v1/models` or `/api/version`; key present; returns `{ ok, reason, latencyMs }`), `plan()`, `review()`, `learn()` and `complete(schema, prompt)` (the generic structured call R-020 and the summaries use). `vendor` is the model's vendor (`meta` for every Muse model), `host` is the serving host.
2. MUST implement routing chains in `config.json` (`routes: { planner: [...], reviewer: [...], learn: [...], summary: [...] }`, each a list of `host/model`), walked in order by `packages/daemon/src/route.ts`: a missing key, `available().ok === false`, HTTP 429, 5xx, a timeout (60 s plan, 120 s review) or a response that fails validation twice moves to the next entry and emits `provider.fallback { role, from, to, reason }`; the chosen `host/model` is stamped on the run (`from.host`) and shown in the UI chip. The defaults are the chains in `AGENTS.md` section 6; a task may override its chain.
3. MUST implement structured output per host: `fireworks` and `meta-api` send `response_format: { type: 'json_schema', json_schema: { name, schema } }` **and** embed the schema in the prompt (Fireworks requires both and disables reasoning under `json_schema`, which is wanted here); `baseten` sends the same but treats the answer as unvalidated: parse, validate with zod, and on failure retry once with the validation errors appended, then fall back down the chain; `ollama` uses Ollama's `format: <schema>` field. All four pass the same zod schema and return the same typed object.
4. MUST implement `plan()`: prompt = task goal and acceptance + `context.json` + the three most similar past tasks (R-018 when present) + skills list; structured output against `schemas/plan.schema.json`; one call, capped at the planner budget; `plan.md` rendered from it; any decision the plan states becomes `decision.recorded`.
5. MUST implement `review()`: prompt = rendered packet + unified diff (capped at 3k tokens, largest hunks first) + `decisions.md` entries valid now + reviewer skills (review-voice-policy first); structured output against `schemas/review.schema.json`; the model marks a finding that proposes reversing a listed decision with `contradictsDecision`; `offline` is true only for `ollama`.
6. MUST implement the contradiction gate in `POST /api/tasks/:id/review`: a finding with `contradictsDecision` (or whose text negates a decision's text by a simple check) is not applied; it is written to the adjudication queue (`.stint/cache/queue/contradiction-<id>.json`) with the decision, the finding and the agent, and `review.recorded { contradictions: n }` is emitted; the task still moves to `awaiting_approval` on `approve`.
7. MUST keep the cache-stable prefix: system framing, skills and plan first and byte-identical across calls, the packet and the ask last; on `fireworks` and `baseten` the usage object's cached-token count is recorded in `cost.cachedTokens` and priced at the cached rate (R-011).
8. MUST handle Ollama absent or the model not pulled with `adapter_unavailable` and a hint naming `ollama pull muse-glimmer:30b-mlx`; a missing partner key shows `unavailable: FIREWORKS_API_KEY not set` in `/api/health`, never a crash.
9. SHOULD warm the local model on `stint up` (one tiny request) and ping each hosted key once so the health chips are honest before the first task.

## Interfaces
- `POST /api/tasks/:id/plan { host?: 'meta-api' | 'fireworks' | 'baseten' | 'ollama' }` → `Plan` (host optional; the chain decides when absent).
- `POST /api/tasks/:id/review { host? }` → `Review`.
- `GET /api/health.adapters[]` gains `host`, `models`, `structuredOutput`, `latencyMs`, and `chains` (the resolved order per role with availability per entry).
- Base URLs and model ids: `meta-api` (Meta Model API, `muse-wonder-1.0`, `muse-spark-1.3`); `baseten` `https://inference.baseten.co/v1`, `meta-models/muse-spark-open-1026` (the hackathon key works with this model only); `fireworks` `https://api.fireworks.ai/inference/v1`, `accounts/fireworks/models/muse-spark-open`; `ollama` `http://localhost:11434/v1`, `muse-glimmer:30b-mlx`. All in `config.json`, never in code.

## Acceptance
1. With a fake OpenAI-compatible server returning a schema-valid plan, `plan()` returns a validated `Plan` and `plan.md` renders its steps: `packages/adapters/openai-compatible/test/plan.test.ts`.
2. A fake `meta-api` answering 429 makes the planner chain fall to `fireworks`, emits `provider.fallback { from: 'meta-api', to: 'fireworks', reason: '429' }`, and the run's `from.host` is `fireworks`: `packages/daemon/test/route.fallback.test.ts`.
3. A fake `baseten` answering invalid JSON once and valid JSON on the retry yields a validated review with one `provider.retry` note in the payload; invalid twice falls to the next host: same file.
4. A review fixture with one finding `contradictsDecision: "D3"` leaves `decisions.md` unchanged, writes a queue file naming the agent, and `review.recorded.payload.contradictions` is 1: `packages/daemon/test/review.contradiction.test.ts`.
5. The `ollama` host returns `offline: true` and `cost.usd: 0`: `packages/daemon/test/review.offline.test.ts` (Ollama up under `STINT_LIVE=1`; fixture server otherwise).
6. With `STINT_LIVE=1` and both partner keys set, one real plan on `fireworks/muse-spark-open` and one real review on `baseten/muse-spark-open` validate, and the Fireworks usage object reports cached tokens on the second identical-prefix call: `packages/adapters/openai-compatible/test/hosts.live.test.ts` (skips with reason otherwise).
7. A review whose text is exactly `No actionable findings.` validates with `verdict: 'approve'` and empty `findings`: `packages/adapters/openai-compatible/test/review.schema.test.ts`.

## Verify
```
bun test packages/adapters/openai-compatible packages/daemon
STINT_LIVE=${STINT_LIVE:-0} bun test packages/adapters/openai-compatible/test/hosts.live.test.ts
```

## Out of scope
Implementing code (only Muse Code and the Stint agent edit files), the learn prompt (R-020), the UI cards (R-016), embeddings (R-018 stretch), dedicated deployments on Baseten.

## Notes
Keep both prompts in `packages/adapters/openai-compatible/prompts/*.md`. The offline review on stage stays on Ollama by design: the hosted Spark Open legs are for planning when Wonder is rate-limited, for the learn step, for the bench's throughput, and as the honest answer to "what if the laptop cannot run Glimmer". Attribution: because Spark Open is in the product, the README carries `Built with Muse Spark Open` (R-023). Treat partner rate limits as facts in `config.json` (`tpm`, `rpm`) so the bench can plan its concurrency; Baseten's 2M TPM is the reason the bench runs there.
