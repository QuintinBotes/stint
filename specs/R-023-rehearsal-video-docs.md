# R-023 · Rehearsal, video, docs

Day: 8 (3 Nov) · Owner: Q (video), Q (docs) · Depends on: R-022 · Fallback: video cut from the best rehearsal · Cut: never

## Goal
Everything a judge reads or clicks is finished and honest: a README with a 90-second quick start, the packet spec, the support matrix, the benchmark chart and the write-up text; three live rehearsals timed; the video recorded from a live run, under 2:40, captions burned in. Agents write the docs; the human records the video and fills the form.

## Context
Submission checklist in the spec doc. Rubric precedent: Demo 30, Impact 25, Model use 25, Depth 20. The first 20 seconds state the problem and show the folder; the last 10 seconds show the cost total and the schema link. Anonymity: the repo and video carry the project name, not personal profiles.

## Requirements (agent part)
1. MUST write `README.md`: one line, the three claims with their evidence (kill-and-continue packet size and token count from the live run, $0.00 offline review, learned skill with the T-0042/T-0043 pair), the 90-second quick start (`git clone`, `scripts/bootstrap.sh`, `stint demo`), the support matrix (macOS and Linux; Windows via WSL, untested), the packet example (the real killed packet from the recording), the benchmark chart with pass rates beside the ratio, what is real versus replayed, what Meta tech is used where (Wonder plan, Spark build via Muse Code, Glimmer review offline, Muse Spark Open on Baseten and Fireworks for planning fallback, the learn step and the bench, Muse Code hooks), the post-hackathon path (including fine-tuning Spark Open on approved packets and skills, which Fireworks offers as a base model), and the `Built with Muse Spark Open` notice, which is required because hosted Spark Open legs are part of the product.
2. MUST write `docs/packet.md` (from R-002, updated with the live example and the multi-hop rule), `docs/adapters.md` (the contract, the three adapters, capability and gate honesty, how to add a fourth), `docs/support.md`, `docs/demo.md` (the beat sheet with timings from the rehearsals and the "what can go wrong" table), `CHANGELOG.md` 0.1.0, and `docs/writeup.md` with the submission text ready to paste.
3. MUST add a docs-as-tests check: `packages/core/test/docs.claims.test.ts` greps README claims that reference a test name or a number from `bench/results.json` or the recording and fails if the referenced test or number does not exist (the README stays honest by construction).
4. MUST run `scripts/guard-identity.mjs` over the whole tree including `docs/` and `demo/`, and ensure the video script in `docs/demo.md` contains no personal name.
5. MUST make `bunx @stint-dev/cli demo` (or `bun x` from the repo) work offline from a clean clone after `bun install`, documented in the quick start.
6. SHOULD add the `LICENSE` file once the human records the decision (D-pending → D-00x) and the licence header to `package.json` files.

## Requirements (human part, recorded in PROGRESS.md Gates)
7. Three live rehearsals on the demo laptop with the network off for the review leg; timings in `docs/demo.md`.
8. Video recorded from a live run (1080p, captions burned in, 2:30 target, 2:40 cap), "replay of a live run on <date>" on screen if any replay segment is used.
9. Keys and credits checked the day before; Ollama model pulled; keys present only on the demo machine.

## Interfaces
- README sections in this order: title line, the three proofs, quick start, what you see (one screenshot of the dark task view), the packet, benchmark, support, what is real, Meta tech, roadmap, licence.

## Acceptance
1. `scripts/bootstrap.sh && stint demo` on a clean clone (CI job "quickstart") completes in under 90 seconds without keys: `.github/workflows/ci.yml` job `quickstart`.
2. `docs.claims.test.ts` passes and fails when a README number is changed by hand: `packages/core/test/docs.claims.test.ts`.
3. `node scripts/guard-identity.mjs` exits 0 on the full tree: CI.
4. `docs/writeup.md` contains the five required parts (pitch, claims with evidence, real vs replayed, Meta tech, roadmap): `packages/core/test/docs.writeup.test.ts`.

## Verify
```
bun test packages/core
node scripts/guard-identity.mjs
bash scripts/bootstrap.sh --check-only
```

## Out of scope
Marketing site, logo, anything post-submission.

## Notes
Quote numbers only from `bench/results.json` and the recording; the test enforces it. Write for a judge who has three minutes: the first screen of the README carries the CI badge, the three proofs and the quick start, nothing else.
