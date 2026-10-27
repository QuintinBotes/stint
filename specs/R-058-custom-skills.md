# R-058 · Custom skills: add your own, by folder, CLI or upload

Day: added 27 Oct at the owner's request · Owner: MC · Depends on: R-020, R-031, R-048 · Fallback: requirements 1, 2 and 4 · Cut order: 6

## Goal
A person can add their own skills, written by hand or brought from another agent, and Stint mounts them exactly as it mounts learned ones: from a folder in the repository, with `stint skills add`, or by uploading in the Skills page.

## Context
A skill is a folder `.agents/skills/<id>/` holding `SKILL.md` (YAML frontmatter `name` and `description`, plus Stint's optional `roles`, `tags`, `origin`, `status`, `evidence`) and any supporting text files. This is the Agent Skills format that Claude Code, Codex and Muse Code also read, so a skill from `.claude/skills/<id>/` or `~/.codex/skills/<id>/` is already in the right shape. The registry is `packages/daemon/src/skills.ts` (`listSkills`, `skillsDir`, `commitSkillFiles`, the approve path and its copies for enabled agents), its routes are `packages/daemon/src/routes/skills.ts`, the CLI is `packages/cli/src/skills.ts`, the page is `apps/web/src/routes/Skills.tsx`, and the frontmatter schema is `SkillFrontmatterSchema` with `parseSkillFrontmatter` in `packages/core/src/schemas/skill.ts`. A skill reaches an agent only as text in its prompt, through the existing mount rules (role, tag, similar task) and cap.

## Requirements
1. MUST add `POST /api/skills` taking `{ files: Array<{ path: string; content: string }>, replace?: boolean }`, where exactly one file is `SKILL.md` at the root of the upload. It validates before writing anything and answers 400 `invalid` listing every problem: the frontmatter parses with `SkillFrontmatterSchema`; `name` is the id and matches `^[a-z0-9]+(-[a-z0-9]+)*$` with at most 64 characters; `description` has 1 to 1024 characters; every path is relative, has no `..` segment, no segment starting with `.`, and no backslash; every file ends in `.md`, `.txt`, `.json`, `.yaml`, `.yml` or `.csv`; at most 20 files, 64 KB each and 256 KB in all; content is text with no NUL byte. An id that already exists answers 409 `conflict` unless `replace` is true.
2. MUST write the files under `.agents/skills/<id>/`, setting `origin: human` in the frontmatter, and `status: active` unless the upload says `probation`; every other byte of `SKILL.md` stays as given. It commits them through the same path an approval uses (`skills.commitTo`, or the checked-out branch) as `Add skill <id>`, or `Replace skill <id>` on a replace, and writes the same copies for enabled agents that an approval writes. It records no new event type: the commit is the record.
3. MUST NOT run, import or follow anything in an uploaded skill. Its text reaches agents only through the existing mount rules and prompt cap.
4. MUST add `stint skills add <path> [--replace]`: the path is a folder holding `SKILL.md` (every eligible file under it, with the same limits) or a single `SKILL.md`. It sends to the daemon and prints the id and the folder written. It needs no other step to bring a skill from another agent's folder.
5. MUST add an "Add a skill" control to the Skills page: choose or drop a `SKILL.md`, or choose a folder. Before sending, it shows the parsed name and description and every problem the daemon would refuse, and "Add skill" stays disabled while there is one. After adding, the list shows the new skill selected; a refusal from the daemon shows inline.
6. MUST write `docs/skills.md`: the format, where skills live, the three ways to add one, how mounting chooses skills (roles, tags, similar tasks), learned against human skills, probation and the eval, and retiring.

## Interfaces
- `POST /api/skills` → 201 `{ id, path: '.agents/skills/<id>', commit: string | null, replaced: boolean }`; 400 `invalid` with `hint` listing the problems; 409 `conflict`.
- `api.addSkill(files, replace?)` in `apps/web/src/api.ts`.
- `stint skills add <path> [--replace] [--json]`.

## Acceptance
1. `POST /api/skills` with a valid `SKILL.md` and `examples.md` writes both under `.agents/skills/<id>/`, commits `Add skill <id>`, and `GET /api/skills` lists it with `origin: human` and `status: active`; a task assigned afterwards whose role the skill names records `skill.applied` for it and lists it in `prompt.md`: `packages/daemon/test/skills.add.test.ts`.
2. Each refusal in Requirement 1 answers 400 naming the problem (no `SKILL.md`, a bad name, a `../` path, a `.sh` file, a 70 KB file) and writes nothing; an existing id answers 409, and with `replace: true` it is replaced and committed as `Replace skill <id>`: `packages/daemon/test/skills.add.test.ts`.
3. `stint skills add` adds a folder, and a single `SKILL.md`; a folder shaped like `.claude/skills/<id>` needs no change: `packages/cli/test/skills.add.test.ts`.
4. In the Skills page, setting a `SKILL.md` on the file input shows its name and description, Add sends it, and the list shows the new skill; a file with a bad name shows the problem and Add stays disabled: `apps/web/e2e/flows/skills-upload.spec.ts`.

## Verify
```
bun run typecheck && bash scripts/check.sh && bun run test:ui
```

## Out of scope
Zip uploads; skills carrying scripts or binaries; a shared catalogue or marketplace; syncing skills between machines.
