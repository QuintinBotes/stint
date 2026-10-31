# Skills: write, import, review, share

This page explains how to write, import and share a skill, and how Stint decides whether a skill may mount.

A skill is a folder of instructions that every agent on a task follows. It lives at `.agents/skills/<id>/` and holds one `SKILL.md`, plus optional `scripts/`, `references/`, `assets/` and `examples.md`. The `SKILL.md` frontmatter carries `name` and `description` (the line agents read to decide whether the skill applies), plus Stint's own fields: `roles`, `tags`, `origin`, `status`, `evidence` and `source`. Agents that do not know those fields ignore them.

Because a skill is instructions, it is also an injection path, and a way to make agents confidently worse. So every skill that mounts in Stint takes the same road: a proposal in the review queue, a pattern scan, a person's approval, probation, and an eval. It does not matter whether the learn step proposed it, a person wrote it, or it arrived from a zip or a git repository.

## Where each agent reads skills

`.agents/skills` is the one source:

| Reader | What it reads |
|---|---|
| Muse Code | `.agents/skills/<id>/SKILL.md` as a project skill, when the workspace is trusted (checked against muse 1.4.13) |
| The Stint agent | The mounted skills list in `prompt.md`, which the daemon writes for every run |
| Plan and review models | The same list, in the prompts the daemon builds for them |
| Claude Code (when enabled) | A mirror of `SKILL.md` at `.claude/skills/<id>/`, copied by the daemon in the same commit |
| Other configured agents | The mounted skills list in `prompt.md` |

Only approved skills with status `active` or `probation` mount, matched by role, by tag, or by similarity to the skill's evidence tasks. Agents see each skill's name and description in the "Skills mounted for this run" section of `prompt.md`.

## Write a good one

- Two or three focused skills per kind of task beat one long one. An agent uses a skill it can keep in view.
- Write from real failures: what went wrong, and what to do instead. A rule with no failure behind it is a preference, and preferences belong in review comments.
- Keep the body under 5,000 tokens. The validator warns above that and refuses above 20,000; put detail in `references/`.
- Say when the skill applies in the `description`. That line is the trigger; a vague description mounts everywhere or nowhere.
- Never put a credential in a skill. Skills are committed and read by every agent.

## Add, write, upload, export

From the CLI, in a repository with the daemon running:

- `stint skills add <source>` brings a skill in from a folder, a `SKILL.md` file, a `.zip`, or a git URL. A git URL takes an optional `#<ref>` and `:<subpath>`, as in `https://example.com/acme/skills#main:widget-care`; the CLI clones with `--depth 1` and records the commit. `--id`, `--roles` and `--tags` adjust what lands in the queue.
- `stint skills new <id> --description <text>` writes a skill in place; `--from-file` takes a body you already wrote.
- `stint skills export <id>` writes an approved skill out as `<id>.zip`, which another repository adds with `stint skills add`. Exporting and re-importing the same folder gives the same digest, so a shared skill is recognisable on arrival.

On the Skills page (`/skills`), Add skill opens a dialog with three tabs:

- **Upload:** drop a `.zip` or a `SKILL.md`, or choose a folder. A lone markdown file becomes the skill's `SKILL.md`, and a folder leaves out `.git` and `.DS_Store`.
- **From git:** a repository URL, with an optional ref and path. The browser cannot clone, so this tab writes out the exact `stint skills add` command, with a Copy button, for you to run in the repository.
- **Write:** name, description, roles, tags and a body, with a live token count.

Before anything is sent, Upload and Write show a preview, checked in the browser with the same validator and scan the daemon uses: the files, the parsed frontmatter, the findings, and the exact line agents will see in `prompt.md`. A block finding disables Add to the queue. The daemon checks the bundle again on arrival; when it refuses, the dialog shows its message and findings as given. The dialog keeps what you typed in every tab while you switch between them, sends once however often you press its button, and asks "Discard this draft?" before Escape, Close or a click outside drops it.

Every skill card shows where the skill came from (written by a person, imported, or learned from reviews) and its source, with a link for a git repository over https. An approved skill has Download, which saves the same zip as `stint skills export`, and Edit, which opens Write filled in from the approved folder. The rest of the folder rides along unchanged, so approving the edit replaces `SKILL.md` and keeps the other files. A proposal gets Download and Edit once it is approved. The list filters by origin and by status, `unreviewed` included.

Clients can also post a bundle to `POST /api/skills/import` with the daemon token, as multipart form data (a zip, a `SKILL.md`, or a folder as several parts) or as JSON with base64 files. The daemon is the gate in every case: it validates the bundle again, in memory, before anything touches disk. Nothing is written under `.agents/skills` at import time. The bundle waits at `.stint/cache/proposals/<id>/` with a digest over its sorted paths and contents, its source and its scan findings, and a `skill.imported` event records it on the workspace log. Importing an id that already exists queues an update instead; approving it replaces the folder and bumps the minor version.

## What the scan checks, and what it does not

When `stint skills add` and `stint skills new` print the findings, they say plainly: scanned by pattern; this is not a security review. The scan flags shapes, not intent:

- **Block:** a credential pattern anywhere in the bundle, or a file that fails validation. A blocked proposal cannot be approved.
- **Warn:** executable scripts, instructions to download and run remote code, reads of credential files, sending data to a URL, phrases that override the instructions in force, and base64 runs over 1 KB. Each warning needs a person's acknowledgement at approval (`stint skills approve <id> --ack <ids>`). On the Skills page, the card lists the findings with the same sentence beside each, and each warning has a checkbox. Approve stays off until every box is ticked, and a block finding turns it off with the reason. An unreviewed folder is scanned in the browser from its export, since the daemon scans only what is imported.
- **Note:** every external host the text names, binary assets with their size, and top-level entries a skill does not usually have.

The scan does not run the skill, read for meaning, or check that the advice is right. A clean scan means only that no known bad shape was found. Reading the skill before you approve it is still the review.

The validator runs before the scan and shapes the bundle: exactly one `SKILL.md` at the root (a single wrapping folder is stripped), frontmatter that fits the schema, relative paths with no `..` or backslashes, regular files only, at most 64 files, 256 KB per file and 1 MB in total, and UTF-8 text outside `assets/`.

## Review, probation, eval, retirement

Approving writes the whole folder to `.agents/skills/<id>/`, sets `status: probation`, commits only those files with `Stint-Skill:` and `Stint-Skill-Source:` trailers, mirrors `SKILL.md` when Claude Code is enabled, and records consent as the folder digest. Rejecting remembers the reason and the digest, so the same bundle is not proposed again.

A skill on probation becomes `active` after three tasks it helped on, and a skill that hurts more than it helps gets a retirement proposal; [`evals.md`](evals.md) has the counts. `stint eval --skill <id>` measures a skill with and without it mounted. An imported skill with no evidence tasks is judged on the three tasks most similar to its name and description (narrowed to tasks sharing a tag when it has tags), or on the golden set when there are none. The summary names the tasks it used. Approval never waits for an eval. The card on the Skills page shows the eval line once one has run, and "not evaluated" until then.

## Unknown skills wait: requireReview

A `SKILL.md` can also arrive by merge, pull or copy, without Stint being asked. With `skills.requireReview` on (the default, shown in health), a folder with no consent digest is listed as `unreviewed`: it does not mount, is not mirrored, and waits in the queue for Approve or Reject. A skill edited after approval reads `stale` and stops mounting until it is approved again.

The workspace's first registry scan is the one exception: it consents to the skills already there, as found. `stint init` runs that scan, so turning Stint on in a repository that has skills changes nothing on day one. Set `skills.requireReview` to `false` in `.stint/config.json` to keep the older behaviour, where a new folder consents on sight and a stale one still mounts.
