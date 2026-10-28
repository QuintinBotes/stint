// The Setup sheet's "Add skill" dialog (R-060): upload, from git, or write, each with a preview of what the daemon
// will check. The browser checks only to show the person; the daemon validates again and is the gate.
import { type Role, RoleSchema, SKILL_LIMITS, type SkillBundleFile, type SkillFinding, type SkillSource, countTokens, scanSkillBundle, skillPromptLine, validateSkillBundle } from '@stint-dev/core';
import { unzipSync } from 'fflate';
import { Fragment, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { DaemonError, api, daemonMessage } from '../api';
import { Dialog } from './Shell';
import { Button, Section, cx } from './ui';

/** The daemon reads an upload whole and refuses one over 4 MB, so the browser says so before sending. */
const MAX_UPLOAD = 4 * 1024 * 1024;

/** A zip's files, inflated in the browser for the preview only. An entry over the file limit is named, not inflated. */
export function unzipBundle(bytes: Uint8Array): { files: SkillBundleFile[]; findings: SkillFinding[] } {
  const findings: SkillFinding[] = [];
  const entries = unzipSync(bytes, {
    filter: (f) => {
      if (f.originalSize <= SKILL_LIMITS.fileBytes) return true;
      findings.push({ id: 'file-too-large', severity: 'block', file: f.name, text: `${f.name} is ${f.originalSize} bytes unzipped; one file may be at most ${SKILL_LIMITS.fileBytes} bytes. Shorten or split it and zip it again.` });
      return false;
    },
  });
  const files = Object.entries(entries)
    .filter(([path]) => !path.endsWith('/'))
    .map(([path, data]) => ({ path, bytes: data }));
  return { files, findings };
}

/** An approved skill's folder, read from its export: Edit starts from it, and an unreviewed skill is scanned from it. */
export async function exportedFiles(id: string): Promise<SkillBundleFile[]> {
  const res = await fetch(api.exportSkillUrl(id));
  if (!res.ok) throw new Error(`the daemon answered ${res.status} to the export of ${id}`);
  return unzipBundle(new Uint8Array(await res.arrayBuffer())).files;
}

const RANK = { block: 0, warn: 1, note: 2 } as const;
const SEVERITY = { block: ['Block', 'text-red'], warn: ['Warn', 'text-yellow'], note: ['Note', 'text-ink-2'] } as const;

/** The scan's findings, worst first, notes folded away. With `onAck`, each warn carries the checkbox Approve waits for. */
export function Findings({ findings, acked, onAck }: { findings: SkillFinding[]; acked?: ReadonlySet<number>; onAck?: (i: number, on: boolean) => void }) {
  const rows = findings.map((f, i) => ({ f, i })).sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity]);
  const item = ({ f, i }: { f: SkillFinding; i: number }) => {
    const [word, tone] = SEVERITY[f.severity];
    const text = (
      <span>
        <span className={cx('font-bold', tone)}>{word}</span> <span className="font-mono text-[12px] break-all">{`${f.file}${f.line ? `:${f.line}` : ''}`}</span> {f.text}
      </span>
    );
    return (
      <li key={i} data-testid="skill-finding" data-severity={f.severity} data-finding={f.id}>
        {f.severity === 'warn' && onAck ? (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={acked?.has(i) ?? false} onChange={(e) => onAck(i, e.target.checked)} data-testid="ack-finding" />
            {text}
          </label>
        ) : (
          text
        )}
      </li>
    );
  };
  const notes = rows.filter((r) => r.f.severity === 'note');
  return (
    <div className="flex flex-col gap-2 text-[14px] leading-5" data-testid="skill-findings">
      {findings.length ? null : <p>The scan found nothing to flag.</p>}
      {onAck && rows.some((r) => r.f.severity === 'warn') ? <p className="text-ink-2">Tick each warning once you have read it and accept it. Approve waits until every one is ticked.</p> : null}
      <ul className="flex flex-col gap-2">{rows.filter((r) => r.f.severity !== 'note').map(item)}</ul>
      {notes.length ? (
        <details>
          <summary className="cursor-pointer text-ink-2 hover:text-ink">
            {notes.length} note{notes.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">{notes.map(item)}</ul>
        </details>
      ) : null}
      <p className="text-[12px] text-ink-2">Scanned by pattern; this is not a security review.</p>
    </div>
  );
}

/** The bundle checked here the way the daemon will check it. */
function checked(files: SkillBundleFile[], extra: SkillFinding[] = []) {
  const check = validateSkillBundle(files);
  const findings = [...extra, ...scanSkillBundle(files)];
  return { check, findings, blocked: findings.some((f) => f.severity === 'block') };
}

/** Before submit: the files, the parsed frontmatter, the findings, and the exact line agents will see in prompt.md. */
function Preview({ result }: { result: ReturnType<typeof checked> }) {
  const { check, findings } = result;
  const fm = check.frontmatter;
  return (
    <div className="flex flex-col pt-2 border-t border-rule" data-testid="skill-preview">
      <Section title="Files">
        <ul className="font-mono text-[12px] leading-5" data-testid="skill-preview-files">
          {check.files.map((f) => (
            <li key={f.path} className="flex justify-between gap-3">
              <span className="break-all">{f.path}</span>
              <span className="shrink-0 tabular text-ink-2">{f.bytes.length} bytes</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Frontmatter">
        {fm ? (
          <dl className="m-0 grid grid-cols-[100px_minmax(0,1fr)] gap-x-4 gap-y-1 text-[14px] leading-5">
            {Object.entries(fm).map(([k, v]) => (
              <Fragment key={k}>
                <dt className="font-mono text-[12px] text-ink-2">{k}</dt>
                <dd className="m-0 break-words">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <p className="text-[14px] text-ink-2">The frontmatter does not read yet; the findings say why.</p>
        )}
      </Section>
      <Section title="Findings">
        <Findings findings={findings} />
      </Section>
      <Section title="The line agents see in prompt.md">
        {fm ? (
          <pre className="font-mono text-[12px] leading-5 whitespace-pre-wrap break-all rounded-[3px] bg-panel p-3" data-testid="skill-prompt-line">
            {skillPromptLine(fm)}
          </pre>
        ) : (
          <p className="text-[14px] text-ink-2">Agents would see nothing: the frontmatter needs a name and a description first.</p>
        )}
        <p className="mt-2 text-[12px] text-ink-2">Under "Skills mounted for this run", once it is approved and mounts for the task.</p>
      </Section>
    </div>
  );
}

type Failure = { message: string; findings: SkillFinding[] };

/** Posts an import; the daemon's refusal is shown in its words, with its findings when it names them. */
function useSend(onAdded: (id: string) => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const send = (posted: Promise<{ id: string }>) => {
    setBusy(true);
    setFailure(null);
    posted
      .then((r) => onAdded(r.id))
      .catch((e: unknown) => {
        const hint = e instanceof DaemonError ? e.error.hint : null;
        const findings = hint && typeof hint === 'object' && Array.isArray((hint as { findings?: unknown }).findings) ? (hint as { findings: SkillFinding[] }).findings : [];
        setFailure({ message: findings.length && e instanceof DaemonError ? e.error.message : daemonMessage(e), findings });
      })
      .finally(() => setBusy(false));
  };
  return { busy, failure, send };
}

function Footer({ ready, blocked, busy, failure, onSubmit, onCancel }: { ready: boolean; blocked: boolean; busy: boolean; failure: Failure | null; onSubmit: () => void; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-3 pt-4">
      {failure ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-[14px] text-red">The daemon did not take it: {failure.message}.</p>
          {failure.findings.length ? <Findings findings={failure.findings} /> : null}
        </div>
      ) : null}
      {ready && blocked ? <p className="text-[14px]">A block finding stops this skill. Fix what it names, then add it again.</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button tone="primary" disabled={!ready || blocked || busy} onClick={onSubmit} data-testid="add-skill-submit">
          {busy ? 'Adding it to the queue' : 'Add to the queue'}
        </Button>
      </div>
    </div>
  );
}

const label = 'flex flex-col gap-2 text-[14px] font-bold';
const field = 'w-full rounded-[3px] border border-ink-3 bg-panel px-3 py-2 text-[14px] font-normal text-ink';
const fileField = 'text-[12px] font-normal text-ink-2 file:mr-3 file:h-8 file:px-3 file:rounded-[3px] file:border file:border-solid file:border-ink-3 file:bg-transparent file:text-[14px] file:font-semibold file:text-ink hover:file:border-ink';

type Picked = { kind: Extract<SkillSource['kind'], 'zip' | 'upload' | 'folder'>; ref: string; send: SkillBundleFile[]; files: SkillBundleFile[]; extra: SkillFinding[] };

function UploadTab({ onAdded, onCancel }: { onAdded: (id: string) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, failure, send } = useSend(onAdded);
  const read = async (f: File, path: string) => ({ path, bytes: new Uint8Array(await f.arrayBuffer()) });
  const take = async (list: File[], folder: boolean) => {
    setProblem(null);
    setPicked(null);
    const first = list[0];
    if (!first) return;
    if (folder) {
      // what git or the Finder leaves in a folder is not part of the skill
      const kept = list.filter((f) => !f.webkitRelativePath.split('/').some((part) => part === '.git' || part === '.DS_Store'));
      const files = await Promise.all(kept.map((f) => read(f, f.webkitRelativePath)));
      setPicked({ kind: 'folder', ref: first.webkitRelativePath.split('/')[0] || first.name, send: files, files, extra: [] });
      return;
    }
    if (list.length > 1) return setProblem('Drop one .zip or one SKILL.md at a time. For a whole folder, use Choose a folder.');
    if (first.size > MAX_UPLOAD) return setProblem(`${first.name} is ${first.size} bytes; the daemon takes at most ${MAX_UPLOAD} bytes in one upload. Remove large assets and try again.`);
    const bytes = new Uint8Array(await first.arrayBuffer());
    if (first.name.toLowerCase().endsWith('.zip')) {
      try {
        const zip = unzipBundle(bytes);
        setPicked({ kind: 'zip', ref: first.name, send: [{ path: first.name, bytes }], files: zip.files, extra: zip.findings });
      } catch {
        setProblem(`${first.name} is not a readable zip. Zip the skill folder again, or drop its SKILL.md instead.`);
      }
      return;
    }
    // a lone markdown file is the skill's SKILL.md, whatever it is called on disk
    const files = [{ path: 'SKILL.md', bytes }];
    setPicked({ kind: 'upload', ref: first.name, send: files, files, extra: [] });
  };
  const result = picked ? checked(picked.files, picked.extra) : null;
  const submit = () => {
    if (!picked) return;
    const form = new FormData();
    for (const f of picked.send) form.append('file', new Blob([f.bytes as Uint8Array<ArrayBuffer>]), f.path);
    form.append('source', JSON.stringify({ kind: picked.kind, ref: picked.ref } satisfies SkillSource));
    send(api.importSkill(form));
  };
  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-col gap-4 p-4 rounded-[3px] border border-dashed border-ink-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void take([...e.dataTransfer.files], false);
        }}
        data-testid="skill-drop"
      >
        <p className="text-[14px]">Drop a .zip or a SKILL.md here, or choose one below.</p>
        <label className={label}>
          A .zip or SKILL.md
          <input type="file" accept=".zip,.md" className={fileField} onChange={(e) => void take([...(e.target.files ?? [])], false)} data-testid="skill-file" />
        </label>
        <label className={label}>
          A folder that holds a SKILL.md
          <input type="file" multiple {...{ webkitdirectory: '' }} className={fileField} onChange={(e) => void take([...(e.target.files ?? [])], true)} data-testid="skill-folder" />
        </label>
      </div>
      {problem ? (
        <p role="alert" className="text-[14px] text-red">
          {problem}
        </p>
      ) : null}
      {result ? <Preview result={result} /> : null}
      <Footer ready={!!result} blocked={!!result?.blocked} busy={busy} failure={failure} onSubmit={submit} onCancel={onCancel} />
    </div>
  );
}

function GitTab({ onCancel }: { onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [path, setPath] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const given = url.trim();
  const ok = /^(https:\/\/|git@|file:\/\/)\S+$/.test(given);
  // the CLI's own source form: <url>#<ref>:<path>, both parts optional
  const at = ref.trim() || path.trim() ? `#${ref.trim()}${path.trim() ? `:${path.trim()}` : ''}` : '';
  const command = `stint skills add '${`${given}${at}`.replace(/'/g, `'\\''`)}'`;
  const copy = () =>
    navigator.clipboard.writeText(command).then(
      () => setCopied('Copied the command.'),
      () => setCopied('The browser did not allow copying. Select the command and copy it by hand.'),
    );
  return (
    <div className="flex flex-col gap-4">
      <label className={label}>
        Repository URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/acme/skills" className={cx(field, 'font-mono')} aria-describedby="git-url-hint" />
      </label>
      <p id="git-url-hint" className={cx('text-[12px] -mt-2', given && !ok ? 'text-red' : 'text-ink-2')}>
        {given && !ok ? 'The CLI clones https://, git@ and file:// URLs. Check how the URL starts.' : 'An https://, git@ or file:// URL.'}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Ref, if not the default branch
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" className={cx(field, 'font-mono')} />
        </label>
        <label className={label}>
          Path to the skill folder, if not the root
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="skills/widget-care" className={cx(field, 'font-mono')} />
        </label>
      </div>
      <Section title="Run this in the repository">
        <p className="mb-3 text-[14px] text-ink-2">The browser cannot clone a repository, so the CLI does: it clones with --depth 1, records the commit, checks the files and posts them to the daemon. The proposal then shows on this sheet with its findings and preview.</p>
        <div className="flex items-start gap-2">
          <pre className="flex-1 min-w-0 font-mono text-[12px] leading-5 whitespace-pre-wrap break-all rounded-[3px] bg-panel p-3" data-testid="git-command">
            {ok ? command : 'stint skills add <url>#<ref>:<path>'}
          </pre>
          <Button disabled={!ok} onClick={() => void copy()} data-testid="copy-git-command">
            Copy
          </Button>
        </div>
        <p aria-live="polite" className="mt-2 text-[12px] text-ink-2">
          {copied ?? ''}
        </p>
      </Section>
      <div className="flex justify-end">
        <Button onClick={onCancel}>Close</Button>
      </div>
    </div>
  );
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

/** SKILL.md from the form: JSON values are valid YAML, and both frontmatter readers take them. */
const skillMarkdown = (fm: Record<string, unknown>, body: string) => ['---', ...Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---', '', body.trim(), ''].join('\n');

function WriteTab({ edit, onAdded, onCancel }: { edit: string | null; onAdded: (id: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(edit ?? '');
  const [description, setDescription] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [tags, setTags] = useState('');
  const [body, setBody] = useState('');
  // on Edit, the rest of the folder and the frontmatter fields the form does not show ride along unchanged
  const [kept, setKept] = useState<{ files: SkillBundleFile[]; fields: Record<string, unknown> }>({ files: [], fields: {} });
  const [loading, setLoading] = useState(!!edit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, failure, send } = useSend(onAdded);
  useEffect(() => {
    if (!edit) return;
    exportedFiles(edit)
      .then((files) => {
        const check = validateSkillBundle(files);
        if (check.frontmatter) {
          // the name stays the folder's id, which is what approving writes into the frontmatter
          const { name: _n, description: d, roles: r, tags: t, origin: _o, status: _s, source: _src, ...rest } = check.frontmatter;
          setDescription(d);
          setRoles(r ?? []);
          setTags((t ?? []).join(', '));
          setKept({ files: check.files.filter((f) => f.path !== 'SKILL.md'), fields: rest });
        }
        setBody(check.body.trim());
      })
      .catch((e: unknown) => setLoadError(`The skill could not be read for editing: ${daemonMessage(e)}. Close this and try Edit again.`))
      .finally(() => setLoading(false));
  }, [edit]);
  const tagList = tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const fm = { name: name.trim(), description: description.trim(), ...(roles.length ? { roles } : {}), ...(tagList.length ? { tags: tagList } : {}), ...kept.fields };
  const files = [{ path: 'SKILL.md', bytes: new TextEncoder().encode(skillMarkdown(fm, body)) }, ...kept.files];
  const ready = !loading && !!fm.name && !!fm.description;
  const result = ready ? checked(files) : null;
  const tokens = countTokens(body);
  const submit = () => send(api.importSkill({ files: files.map((f) => ({ path: f.path, base64: toBase64(f.bytes) })), source: { kind: 'editor', ref: 'setup sheet' }, id: fm.name }));
  if (loading) return <p className="text-[14px] text-ink-2">Reading {edit}.</p>;
  return (
    <div className="flex flex-col gap-4">
      {loadError ? (
        <p role="alert" className="text-[14px] text-red">
          {loadError}
        </p>
      ) : null}
      <label className={label}>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!edit} required maxLength={64} className={cx(field, 'font-mono')} aria-describedby="skill-name-hint" data-testid="skill-name" />
      </label>
      <p id="skill-name-hint" className="text-[12px] text-ink-2 -mt-2">
        {edit ? 'The id stays the same; approving the edit replaces the folder and bumps the version.' : 'Lowercase words joined by dashes, at most 64 characters. It is the skill id.'}
      </p>
      <label className={label}>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={1024} rows={2} className={field} aria-describedby="skill-description-hint" data-testid="skill-description" />
      </label>
      <p id="skill-description-hint" className="text-[12px] text-ink-2 -mt-2">
        When an agent should use it. This is the line every agent reads, so name the kind of task.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[14px] font-bold">Given to</legend>
        <div className="flex flex-wrap gap-4">
          {RoleSchema.options.map((r) => (
            <label key={r} className="inline-flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles((now) => (e.target.checked ? [...now, r] : now.filter((x) => x !== r)))} />
              {r}
            </label>
          ))}
        </div>
        <p className="text-[12px] text-ink-2">With none ticked, every role gets it.</p>
      </fieldset>
      <label className={label}>
        Tags, comma separated
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="limits, config" className={field} />
      </label>
      <label className={label}>
        Body
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className={cx(field, 'font-mono text-[12px] leading-5')} aria-describedby="skill-body-tokens" data-testid="skill-body" />
      </label>
      <p id="skill-body-tokens" className={cx('text-[12px] -mt-2 tabular', tokens > SKILL_LIMITS.maxTokens ? 'text-red' : tokens > SKILL_LIMITS.warnTokens ? 'text-yellow' : 'text-ink-2')} data-testid="skill-body-tokens">
        About {tokens.toLocaleString('en')} tokens. Keep it under {SKILL_LIMITS.warnTokens.toLocaleString('en')}; write it from a real failure, and put detail in references/.
      </p>
      {result ? <Preview result={result} /> : <p className="text-[14px] text-ink-2">The preview shows once the name and the description are filled in.</p>}
      <Footer ready={ready} blocked={!!result?.blocked} busy={busy} failure={failure} onSubmit={submit} onCancel={onCancel} />
    </div>
  );
}

type Tab = 'upload' | 'git' | 'write';
const TABS: Array<[Tab, string]> = [
  ['upload', 'Upload'],
  ['git', 'From git'],
  ['write', 'Write'],
];

/** Open while mounted; mount it per use so each opening starts clean. `edit` opens Write on that skill. */
export function AddSkillDialog({ edit, onClose, onAdded }: { edit: string | null; onClose: () => void; onAdded: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>(edit ? 'write' : 'upload');
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  // after the dialog has noted the opener, so closing it gives focus back there
  useEffect(() => tabs.current[edit ? 'write' : 'upload']?.focus(), [edit]);
  const arrows = (e: KeyboardEvent) => {
    const at = TABS.findIndex(([k]) => k === tab);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const next = (TABS[(at + step + TABS.length) % TABS.length] as [Tab, string])[0];
    setTab(next);
    tabs.current[next]?.focus();
  };
  return (
    <Dialog title={edit ? `Edit ${edit}` : 'Add skill'} open onClose={onClose} width="max-w-[720px]">
      <div data-testid="add-skill-dialog">
        <p className="mb-4 text-[12px] text-ink-2">It waits in the review queue with its findings. Nothing mounts until you approve it.</p>
        <div role="tablist" aria-label="How to add the skill" className="flex gap-4 mb-4" onKeyDown={arrows}>
          {TABS.map(([k, name]) => (
            <button
              key={k}
              ref={(el) => {
                tabs.current[k] = el;
              }}
              type="button"
              role="tab"
              id={`add-skill-tab-${k}`}
              aria-selected={tab === k}
              aria-controls={`add-skill-panel-${k}`}
              tabIndex={tab === k ? 0 : -1}
              onClick={() => setTab(k)}
              className={cx('pb-1 border-b-[3px] text-[14px] font-bold', tab === k ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink')}
              data-testid={`add-skill-tab-${k}`}
            >
              {name}
            </button>
          ))}
        </div>
        {/* every panel stays mounted, so switching tabs keeps what was typed or chosen */}
        <div role="tabpanel" id="add-skill-panel-upload" aria-labelledby="add-skill-tab-upload" hidden={tab !== 'upload'}>
          <UploadTab onAdded={onAdded} onCancel={onClose} />
        </div>
        <div role="tabpanel" id="add-skill-panel-git" aria-labelledby="add-skill-tab-git" hidden={tab !== 'git'}>
          <GitTab onCancel={onClose} />
        </div>
        <div role="tabpanel" id="add-skill-panel-write" aria-labelledby="add-skill-tab-write" hidden={tab !== 'write'}>
          <WriteTab edit={edit} onAdded={onAdded} onCancel={onClose} />
        </div>
      </div>
    </Dialog>
  );
}
