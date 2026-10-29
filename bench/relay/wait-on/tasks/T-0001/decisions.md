# Decisions for T-0001

## D1 · 2026-10-29T14:33:29.392Z · codex r3
expectBody accepts a non-empty string or a RegExp instance, validated by Joi as alternatives(string min 1, object instance RegExp)
evidence: T-0001/r3#01M641921BACVGJJNKM12QVMFT

## D2 · 2026-10-29T14:33:29.394Z · codex r3
expectBody with any http:/https: HEAD resource fails fast with an error naming expectBody and directing to the http-get:/https-get: (-get) form
evidence: T-0001/r3#01M641921BACVGJJNKM12QVMFT

## D3 · 2026-10-29T14:33:29.394Z · codex r3
when expectBody is set on a GET request, axios reads raw text (responseType text with identity transform) so matching sees the exact payload
evidence: T-0001/r3#01M641921BACVGJJNKM12QVMFT

## D4 · 2026-10-29T14:33:29.394Z · codex r3
tests: test/types.test-d.ts changed because the task acceptance requires the type tests to cover the new expectBody option
evidence: T-0001/r3#01M641921BACVGJJNKM12QVMFT

