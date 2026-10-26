// Writes schemas/examples/handoff-{completed,killed,capped}.json with correct hashes and prints their rendered size.
// The killed example is the demo's packet: it must render to 412 tokens and about 1.4 KB.
import { join } from 'node:path';
import { type Handoff, HandoffSchema, countTokens, hashHandoff, renderHandoff } from '../src/node';

const BASE = 'be1bee8d153659647701b8f5886f0a5c73cf276a';
const createdAt = '2026-11-02T14:41:07Z';

type Draft = Omit<Handoff, 'hash'>;

const killed: Draft = {
  version: 'stint.handoff/1',
  task: 'T-0042',
  from: {
    adapter: 'muse-code',
    vendor: 'meta',
    model: 'muse-spark-1.3',
    role: 'implementer',
    run: 'r2',
    endedBy: 'killed',
    sessionId: '01a1787f-4d06-7ca1-8d41-34127655ceb9',
    host: 'local-cli',
  },
  to: { adapter: 'claude-code', role: 'implementer' },
  summary:
    'Added a per-tenant sliding window limiter and wired it into POST /webhooks before the body is read. The run was killed while it was writing the tests for the 429 response.',
  done: [
    'Sliding window limiter in src/lib/limiter.ts',
    'Limiter wired into POST /webhooks before the body is read',
    'Three limiter unit tests pass',
  ],
  open: ['Tests for the 429 response and the Retry-After header', 'Read the limit and the window from config'],
  leftOut: [
    'In-flight step unknown: write_file test/ratelimit.test.ts',
    'src/config.ts was planned but not touched',
  ],
  refusals: [],
  decisions: [{ id: 'D3', text: 'Sliding window over fixed window, so a burst at a window edge cannot double the limit' }],
  risks: ['Limiter state is in memory and resets on restart', 'The limit of 60 per minute is hard-coded in the limiter'],
  changedFiles: [
    { path: 'src/lib/limiter.ts', added: 41, removed: 0, run: 'r2' },
    { path: 'src/routes/webhooks.ts', added: 9, removed: 1, run: 'r2' },
    { path: 'test/limiter.test.ts', added: 38, removed: 0, run: 'r2' },
  ],
  diffRef: { base: BASE, head: '7c41e0a9d2b5f3c8e6a1d4b7f0c3e9a2d5b8f1c4' },
  verification: { command: 'bun run test', exitCode: 0, passed: 30, failed: 0, durationMs: 1630, runBy: 'daemon', status: 'green' },
  askOfNext:
    'Check the unknown step first: test/ratelimit.test.ts may be half written. Then test the 429 response and Retry-After, and read the limit from config.',
  cost: { inputTokens: 18420, cachedTokens: 11200, outputTokens: 3910, usd: 0.0303 },
  createdAt,
};

const completed: Draft = {
  ...killed,
  from: { ...killed.from, endedBy: 'completed', sessionId: '01a1787f-4d06-7ca1-8d41-34127655ceb0' },
  to: { adapter: 'ollama', role: 'reviewer' },
  summary: 'Rate-limited POST /webhooks per tenant with a sliding window and a 429 response with Retry-After. Four tests added; the suite is green.',
  done: [
    'Sliding window limiter in src/lib/limiter.ts',
    'POST /webhooks answers 429 with Retry-After when a tenant is over the limit',
    'Four tests for the limiter and the 429 response',
  ],
  open: [],
  leftOut: ['src/config.ts was not changed: the limit is still a constant'],
  changedFiles: [
    { path: 'src/lib/limiter.ts', added: 44, removed: 0, run: 'r2' },
    { path: 'src/routes/webhooks.ts', added: 11, removed: 1, run: 'r2' },
    { path: 'test/limiter.test.ts', added: 52, removed: 0, run: 'r2' },
  ],
  diffRef: { base: BASE, head: '3f9a2c7e1b4d8f6a0c5e9b2d7f1a4c8e3b6d0f9a' },
  verification: { command: 'bun run test', exitCode: 0, passed: 31, failed: 0, durationMs: 1710, runBy: 'daemon', status: 'green' },
  askOfNext: 'Review the limiter against the decisions and AGENTS.md; check that limits come from config.',
  cost: { inputTokens: 26180, cachedTokens: 17900, outputTokens: 5120, usd: 0.0386 },
};

const capped: Draft = {
  ...killed,
  from: { ...killed.from, endedBy: 'capped', sessionId: '01a1787f-4d06-7ca1-8d41-34127655ceb1' },
  summary: 'Reached the 60-step cap after adding the limiter and wiring it into POST /webhooks. The 429 tests were not started.',
  done: ['Sliding window limiter in src/lib/limiter.ts', 'Limiter wired into POST /webhooks'],
  open: ['Unit tests for the limiter', 'Tests for the 429 response and the Retry-After header', 'Read the limit from config'],
  leftOut: ['No tests were written for the limiter yet'],
  changedFiles: [
    { path: 'src/lib/limiter.ts', added: 39, removed: 0, run: 'r2' },
    { path: 'src/routes/webhooks.ts', added: 9, removed: 1, run: 'r2' },
  ],
  diffRef: { base: BASE, head: 'a8d3f1c6e9b2a5d8f0c3e6b9a2d5f8c1e4b7a0d3' },
  verification: { command: 'bun run test', exitCode: 0, passed: 27, failed: 0, durationMs: 1490, runBy: 'daemon', status: 'green' },
  askOfNext: 'Add unit tests for the limiter first, then the 429 response tests, then read the limit from config.',
  cost: { inputTokens: 41200, cachedTokens: 30100, outputTokens: 6020, usd: 0.0484 },
};

for (const [name, draft] of Object.entries({ completed, killed, capped })) {
  const packet = HandoffSchema.parse({ ...draft, hash: hashHandoff(draft) });
  const text = renderHandoff(packet);
  await Bun.write(join(import.meta.dir, '..', 'schemas', 'examples', `handoff-${name}.json`), `${JSON.stringify(packet, null, 2)}\n`);
  console.log(`${name}: ${countTokens(text)} tokens, ${new TextEncoder().encode(text).length} bytes`);
}
