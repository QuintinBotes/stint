# R-060 · Custom skills: write, import, upload, review, share

Day: 3 (29 Oct) · Owner: CC · Depends on: R-020, R-031, R-048 · Fallback: CLI import from a folder or SKILL.md, plus the review gate for unknown skills; no zip, git, or UI upload · Cut order: 3

## Goal
People bring their own skills as easily as the factory learns them. A person can write a skill in the UI or CLI, import one from a folder, a `SKILL.md`, a `.zip`, or a git URL, or upload one on the Skills page, and export any skill to share it. Every skill that did not come from the learn step goes through the same queue, the same scan, and the same probation and eval before it mounts. A skill is instructions every agent will follow, which makes it a prompt-injection path. Unvetted skills can also make agents worse: in SkillsBench, self-generated skills averaged minus 1.3 points.

## Context
- **Registry.** The registry is `packages/daemon/src/skills.ts`. Its `listSkills` and `skillsForTask` handle origin (`human` or `learn-loop`), status (`active`, `probation`, `proposed`, or `retired`), a consent digest over SKILL.md, and `stale`.
- **Routes.** `packages/daemon/src/routes/skills.ts` has list, approve, reject, evaluated, retire, and keep. The CLI is `packages/cli/src/skills.ts` (list, approve, reject), and the UI is `apps/web/src/routes/Skills.tsx`.
- **Supporting pieces.** The schema is `schemas/skill.schema.json`. Mirroring to `.claude/skills` comes from R-048. `stint eval --skill` and probation come from R-031. The agentskills.io format is a folder with `SKILL.md` plus optional `scripts/`, `references/`, and `assets/`; `name` is at most 64 characters and `description` at most 1,024.
- **Gap 1: unknown skills are trusted silently.** A `SKILL.md` that appears under `.agents/skills` with no consent digest gets a digest recorded on first sight and mounts at once (`listSkills`: "a skill Stint has no digest for records one the first time the registry sees it"). That includes a skill that arrives through a merge, a pull, or a person's copy-paste.
- **Gap 2: stale skills still mount.** A skill that changed since approval is marked `stale` but still mounts, because `mountsFor` checks status only.
- **Gap 3: skill events need a task.** They go to an evidence task's log (`emitSkillEvent`), and there is no workspace-level log for a skill that has no task.
- **Gap 4: no import path.** There is no import, upload, or export, no zip handling in the daemon (`stint export` shells out to `zip`), and no validation beyond parsing the frontmatter.

## Requirements
1. **Workspace log.**
   - MUST add `.stint/workspace/events.jsonl`, an `EventLog` (hash chained, daemon-only writer) for events that belong to no task.
   - Skill events with no task go there.
   - `GET /api/workspace/events` serves it, and the Skills page reads it.
2. **One bundle validator.**
   - MUST add `validateSkillBundle(files: Array<{ path: string; bytes: Uint8Array; mode?: number }>): SkillBundleCheck` in `@stint-dev/core` (browser-safe), with no filesystem access.
   - **Structure.** Exactly one `SKILL.md`, at the root of the bundle (a single top folder is stripped).
   - **Frontmatter.**
     - It validates against `schemas/skill.schema.json`.
     - `name` matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is at most 64 characters.
     - `description` is 1 to 1,024 characters.
   - **Paths.**
     - Relative only.
     - No `..`, no absolute paths, no backslashes, no NUL.
     - No symlinks, devices, or other non-regular files (checked from `mode` when given).
     - At most 64 files and 256 KB per file, 1 MB in total.
     - Text files must be valid UTF-8.
   - **Body size.** Over 5,000 tokens (`countTokens`) warns; over 20,000 refuses.
   - **Top-level entries.** `SKILL.md`, `scripts/`, `references/`, `assets/`, and `examples.md` are expected. Anything else is a note.
3. **The scan.**
   - MUST add `scanSkillBundle(files): SkillFinding[]`. Each finding has `{ id, severity: 'block'|'warn'|'note', file, line?, text }`. The card says "Scanned by pattern; this is not a security review."
   - **block**:
     - a credential pattern (reuse the scrub patterns the packet builder uses);
     - a file that fails validation.
   - **warn**:
     - executable scripts (anything under `scripts/`, or a shebang);
     - instructions to fetch and run remote code (`curl` or `wget` piped to a shell, `eval` of fetched text);
     - instructions to read credential paths (`~/.ssh`, `.env`, cloud credential files);
     - instructions to send data to a URL;
     - phrases that override instructions ("ignore previous", "disregard the system");
     - base64 runs over 1 KB.
   - **note**:
     - each external host named in the body;
     - binary assets with their size;
     - unexpected top-level entries.
4. **Origins and statuses.**
   - MUST add origin `import` to the skill schema, its zod mirror, and the mutation test. `human` now means written in Stint, `import` means from a file, folder, zip, or git, and `learn-loop` is unchanged.
   - MUST add status `unreviewed`.
   - MUST add `source` to the frontmatter superset: `{ kind: 'upload'|'folder'|'zip'|'git'|'editor', ref: string, commit?: string }`.
5. **Proposals.**
   - MUST put every imported, uploaded, or written skill into the queue as a proposal folder: `.stint/cache/proposals/<id>/` holding the bundle files, plus `proposal.json` with origin, source, a digest over the sorted paths and contents, findings, and who submitted it.
   - MUST emit `skill.imported { id, origin, source, digest, findings }` on the workspace log.
   - MUST write nothing under `.agents/skills` before approval.
   - An id that already exists becomes an update proposal for that skill (`skill.edit_proposed`). Approving it replaces the folder and bumps the minor `version`.
6. **Approve, reject, and the gate.**
   - **Approve** reuses the existing path:
     - writes the whole folder to `.agents/skills/<id>/`;
     - sets `status: probation`;
     - commits only those files with the trailers `Stint-Skill: <id>` and `Stint-Skill-Source: <kind>:<ref>`;
     - mirrors to `.claude/skills` when Claude Code is enabled;
     - records consent as the folder digest, not the SKILL.md digest.
   - **Gate.** A proposal with a `block` finding cannot be approved; the route returns `skill_blocked` with the findings. A `warn` finding needs `{ acknowledge: [findingIds] }` in the approve body. The UI shows a checkbox for each one.
   - **Reject** records the reason and the digest, so the same bundle is not proposed again.
7. **Unknown and stale skills stop mounting.**
   - With `config.skills.requireReview` true (the default), a skill folder under `.agents/skills` with no consent digest is listed as `unreviewed`. It is not mounted, is not mirrored, and gets Approve and Reject in the queue.
   - The workspace's first registry scan, when no consent file exists yet, consents to what is there, as today. `stint init` runs that scan.
   - A `stale` skill also stops mounting until it is approved again, and the card says so.
   - With `requireReview` false, today's behaviour is kept. Health shows the setting.
8. **Add from the CLI.** MUST add `stint skills add <source> [--id <id>] [--roles r1,r2] [--tags t1,t2]`. The source is one of:
   - a folder;
   - a `SKILL.md` file;
   - a `.zip`;
   - a git URL, in the forms `https://...`, `git@...`, or `file://...`, optionally followed by `#<ref>` and `:<subpath>`.

   The CLI reads the source, clones git with `--depth 1` into a temporary folder, and records the commit. It posts the files to the daemon, which validates them again. Validation in the CLI is a courtesy; the daemon is the gate.
9. **Write from the CLI.** MUST add `stint skills new <id> --description <text> [--roles] [--tags] [--from-file body.md]`, which submits an `editor`-sourced proposal.
10. **Upload route.**
    - MUST add `POST /api/skills/import`. It requires the bearer token and accepts:
      - `multipart/form-data` with one `.zip` or `SKILL.md` part;
      - a folder as several parts with relative paths;
      - JSON `{ files: [{ path, base64 }], source }`.
    - The daemon unzips in memory with `fflate`, adding a `Decision:` line with the pinned exact version. It validates every entry before anything touches disk, and rejects zip-slip, symlink, and size violations with `skill_invalid` and the findings.
11. **Export.** MUST add `GET /api/skills/:id/export`, which returns `<id>.zip`, and `stint skills export <id> [--out <path>]`. The export carries the folder as approved, with Stint's frontmatter fields kept (agents ignore fields they do not know). Re-importing an export reproduces the same digest.
12. **Eval for skills with no evidence.**
    - MUST make `stint eval --skill <id>` work for an imported proposal with no evidence tasks. It uses the three tasks most similar to the skill: `similarText(ws, { title: name, goal: description })` from `@stint-dev/core/node`, filtered to tasks that share a tag when the skill has tags. With none, it uses the golden set.
    - The eval summary names which tasks it used, and the proposal card shows the eval line once it runs.
    - Approve does not require an eval. The card says "not evaluated" when there is none.
13. **Skills page.**
    - MUST add an "Add skill" button that opens a dialog with three tabs:
      - **Upload**: drop a `.zip` or `SKILL.md`, or pick a folder.
      - **From git**: a URL plus an optional ref and path.
      - **Write**: name, description, roles, tags, and a body with a live token count.
    - Each tab shows a preview before submit: the files, the parsed frontmatter, the findings, and the exact line agents will see in `prompt.md`.
    - Every skill card shows its origin, its source (a link for git), a Download button, and an Edit button that opens Write prefilled.
    - Add a filter by origin and by status, including `unreviewed`.
14. **Docs.** MUST add `docs/skills.md`, covering:
    - what a skill is and where each agent reads skills (the readership matrix);
    - how to write a good one: two or three focused skills per kind of task, written from real failures, with the body kept under 5,000 tokens;
    - add, upload, import, and export;
    - what the scan checks and what it does not;
    - review, probation, eval, and retirement;
    - `requireReview`.

## Interfaces
- **CLI.**
  - `stint skills add <source> [--id] [--roles] [--tags] [--json]`
  - `stint skills new <id> --description <text> [--roles] [--tags] [--from-file]`
  - `stint skills export <id> [--out]`
  - `stint skills approve <id> [--ack <findingId,...>]`
- **Routes.**
  - `POST /api/skills/import` returns `{ id, proposal: SkillRecord, findings: SkillFinding[] }`.
  - `POST /api/skills/:id/approve { acknowledge?: string[] }`.
  - `GET /api/skills/:id/export`.
  - `GET /api/workspace/events`.
- **Error codes** (a recorded Deviation per SPEC-000):
  - `skill_invalid`, 422, with `findings`;
  - `skill_blocked`, 409, with `findings`;
  - `skill_unacknowledged`, 409, with the warn ids.
- **Events.** `skill.imported`, `skill.edit_proposed`, and `skill.unreviewed` (emitted once per digest when a scan finds one).
- **Schema.** Origin is `human | import | learn-loop`. Status is `active | probation | proposed | unreviewed | retired`. `source` is as in Requirement 4.
- **Config.** `skills.requireReview: boolean`, default `true`.

## Acceptance
1. `validateSkillBundle` refuses each of these: `../x`, `/etc/x`, a symlink mode, a 300 KB file, 65 files, a bad name, and a missing description. It accepts the fixture's `review-voice-policy` folder. Test: `packages/core/test/skills.validate.test.ts`.
2. `scanSkillBundle` flags each of these: a fake key in the body as `block`; `curl ... | sh` as `warn`; a `scripts/run.sh` as `warn`; an `https://example.com` link as `note`. Test: `packages/core/test/skills.scan.test.ts`.
3. `POST /api/skills/import` with a zip creates `.stint/cache/proposals/<id>/`, writes nothing under `.agents/skills`, and emits `skill.imported` on the workspace log. Without the token it returns 401. A zip with a `../` entry returns `skill_invalid` and writes nothing. Test: `packages/daemon/test/skills.import.test.ts`.
4. Approving an imported proposal writes every file, commits with both trailers, mirrors to `.claude/skills` when enabled, and the next run's `prompt.md` lists it. A `block` proposal returns `skill_blocked`. A `warn` proposal without `acknowledge` returns `skill_unacknowledged`. Test: `packages/daemon/test/skills.import.approve.test.ts`.
5. These cases are covered:
   - A `SKILL.md` copied into `.agents/skills` after the first scan is `unreviewed`, is not in `prompt.md`, and emits `skill.unreviewed` once.
   - Skills present at the first scan stay active.
   - Editing an approved skill makes it stale and unmounted until it is approved again.
   - With `requireReview: false`, all of these mount as today.

   Test: `packages/daemon/test/skills.review.test.ts`.
6. Export, then import, reproduces the same digest. Test: `packages/daemon/test/skills.export.test.ts`.
7. `stint skills add` works from a folder, a `SKILL.md`, a zip, and a `file://` git URL with `#ref:subpath` built in a temporary bare repository, and records the commit in `source`. Test: `packages/cli/test/skills.add.test.ts`.
8. `stint eval --skill <imported> --replay` names the similar tasks it used. Test: `packages/cli/test/eval.skill.imported.test.ts`.
9. In the UI: upload a zip, see its findings, acknowledge the warn, approve, and see it on the Skills page with origin `import` and a Download button. Test: `apps/web/e2e/flows/skills-upload.spec.ts`.

## Verify
```
bun test packages/core packages/daemon packages/cli
bun run typecheck
bun run build:web && bun run test:ui
```

## Out of scope
- A public skill marketplace or registry.
- Signing skills.
- Executing a skill's scripts in any way beyond what the run sandbox already allows.
- Automatic approval of imported skills.

## Notes
- The daemon stays the only writer of `.stint/` and of the approval commit. The CLI and the UI only post bundles.
- Validate before extracting. Never write a zip entry to disk and then check its path.
- Keep pattern lists in one module, `packages/core/src/skills/patterns.ts`, with a test per pattern, so they can be extended without touching the scanner.
- `fflate` is the only new dependency. If a reason not to add it appears, fall back to `unzip -Z1` to list entries and validate them before `unzip -o -d <tmp>`, and record a Deviation.
