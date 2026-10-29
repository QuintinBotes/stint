// The Skills page's "Add skill" dialog (R-060): upload, from git, or write, each with a preview of what the daemon
// will check. The browser checks only to show the person; the daemon validates again and is the gate.
import { type Role, RoleSchema, SKILL_LIMITS, type SkillBundleFile, type SkillFinding, type SkillSource, countTokens, scanSkillBundle, skillPromptLine, validateSkillBundle } from '@stint-dev/core';
import { unzipSync } from 'fflate';
import { Fragment, useEffect, useRef, useState } from 'react';
import { DaemonError, api, daemonMessage } from '../api';
import { Dialog } from './Shell';
import { Button, Section, cx, tabClass, tabKeys } from './ui';

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
  if (!res.ok) throw new Error(`Stint answered ${res.status} to the export of ${id}`);
  return unzipBundle(new Uint8Array(await res.arrayBuffer())).files;
}

const RANK = { block: 0, warn: 1, note: 2 } as const;
const SEVERITY = { block: ['Blocks it', 'text-red'], warn: ['Warning', 'text-amber'], note: ['Note', 'text-ink-2'] } as const;

/** The scan's findings, worst first, notes folded away. With `onAck`, each warning carries the checkbox Approve waits for; the caller says so beside Approve. */
export function Findings({ findings, acked, onAck }: { findings: SkillFinding[]; acked?: ReadonlySet<number>; onAck?: (i: number, on: boolean) => void }) {
  const rows = findings.map((f, i) => ({ f, i })).sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity]);
  const item = ({ f, i }: { f: SkillFinding; i: number }) => {
    const [word, tone] = SEVERITY[f.severity];
    const text = (
      <span>
        <span className={cx('font-semibold', tone)}>{word}</span> <span className="font-mono text-small break-all">{`${f.file}${f.line ? `:${f.line}` : ''}`}</span> {f.text}
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
    <div className="flex flex-col gap-2 text-body" data-testid="skill-findings">
      {findings.length ? null : <p>Nothing to flag.</p>}
      <ul className="flex flex-col gap-2">{rows.filter((r) => r.f.severity !== 'note').map(item)}</ul>
      {notes.length ? (
        <details>
          <summary className="w-fit leading-6 cursor-pointer text-ink-2 hover:text-ink">
            {notes.length} note{notes.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">{notes.map(item)}</ul>
        </details>
      ) : null}
      <p className="text-small text-ink-2">Found by simple text patterns; this is not a security review.</p>
    </div>
  );
}

/** The bundle checked here the way the daemon will check it. */
function checked(files: SkillBundleFile[], extra: SkillFinding[] = []) {
  const check = validateSkillBundle(files);
  const findings = [...extra, ...scanSkillBundle(files)];
  return { check, findings, blocked: findings.some((f) => f.severity === 'block') };
}

/** Before submit: the findings first, then the files; the parsed header and the exact line agents will see wait behind a disclosure. */
function Preview({ result }: { result: ReturnType<typeof checked> }) {
  const { check, findings } = result;
  const fm = check.frontmatter;
  return (
    <div className="flex flex-col pt-2 border-t border-rule" data-testid="skill-preview">
      <Section title="Findings">
        <Findings findings={findings} />
      </Section>
      <Section title="Files">
        <ul className="font-mono text-code" data-testid="skill-preview-files">
          {check.files.map((f) => (
            <li key={f.path} className="flex justify-between gap-3">
              <span className="break-all">{f.path}</span>
              <span className="shrink-0 tabular text-ink-2">{f.bytes.length} bytes</span>
            </li>
          ))}
        </ul>
      </Section>
      <details className="py-3">
        <summary className="w-fit leading-6 cursor-pointer font-semibold hover:text-ink-2">Details: the SKILL.md header and what agents see</summary>
        <h3 className="mt-3 mb-2 font-semibold">SKILL.md header</h3>
        {fm ? (
          <dl className="m-0 grid grid-cols-[100px_minmax(0,1fr)] gap-x-4 gap-y-1 text-body">
            {Object.entries(fm).map(([k, v]) => (
              <Fragment key={k}>
                <dt className="font-mono text-small text-ink-2">{k}</dt>
                <dd className="m-0 break-words">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <p className="text-body text-ink-2">The header does not read yet; the findings say why.</p>
        )}
        <h3 className="mt-4 mb-2 font-semibold">What agents see</h3>
        {fm ? (
          <pre className="font-mono text-code whitespace-pre-wrap break-all rounded-[5px] bg-ground p-3" data-testid="skill-prompt-line">
            {skillPromptLine(fm)}
          </pre>
        ) : (
          <p className="text-body text-ink-2">Agents would see nothing: the header needs a name and a description first.</p>
        )}
        <p className="mt-2 text-small text-ink-2">This line goes into each run's prompt.md once you approve the skill.</p>
      </details>
    </div>
  );
}

type Failure = { message: string; findings: SkillFinding[] };

/** Posts an import, one at a time; the daemon's refusal is shown in its words, with its findings when it names them. */
function useSend(onAdded: (id: string) => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const send = (posted: () => Promise<{ id: string }>) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    posted()
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

const BLOCKED = 'A blocking finding stops this skill. Fix what it names, then try again.';

/** What a tab gives the dialog's footer: what its submit waits for, its words, and the send in flight. */
type Submit = { why: string | null; label: string; busy: boolean; failure: Failure | null; onSubmit: () => void };

/** The footer: the daemon's refusal, what the submit waits for (beside it and as its description, so a disabled button is never mute), Cancel, which asks first once anything is chosen or typed, and the submit, which says when it is sending. From git has no submit. */
function Actions({ submit, dismiss }: { submit: Submit | null; dismiss: () => void }) {
  const cancel = <Button onClick={dismiss}>Cancel</Button>;
  if (!submit) return cancel;
  const { why, label, busy, failure, onSubmit } = submit;
  return (
    <>
      {failure ? (
        <p role="alert" className="basis-full stint-field-error" data-testid="add-skill-failure">
          Stint did not add it: {failure.message}.
        </p>
      ) : null}
      {why ? (
        <p id="add-skill-why" className="mr-auto stint-field-help" data-testid="add-skill-why">
          {why}
        </p>
      ) : null}
      {cancel}
      <Button tone="primary" aria-disabled={!!why || busy} aria-busy={busy || undefined} aria-describedby={why ? 'add-skill-why' : undefined} onClick={onSubmit} data-testid="add-skill-submit">
        {busy ? 'Sending' : label}
      </Button>
    </>
  );
}

/** The findings the daemon named when it refused, in the body above the footer that says it refused. */
function Refused({ failure }: { failure: Failure | null }) {
  return failure?.findings.length ? (
    <div className="flex flex-col gap-2" data-testid="add-skill-refused">
      <h3 className="font-semibold">What Stint found</h3>
      <Findings findings={failure.findings} />
    </div>
  ) : null;
}

const fileField = 'text-small font-normal text-ink-2 file:mr-3 file:h-8 file:px-3 file:rounded-[5px] file:border file:border-solid file:border-rule-strong file:bg-transparent file:text-body file:font-semibold file:text-ink hover:file:border-ink-2';

type Picked = { kind: Extract<SkillSource['kind'], 'zip' | 'upload' | 'folder'>; ref: string; send: SkillBundleFile[]; files: SkillBundleFile[]; extra: SkillFinding[] };

/** Upload's draft: the file or folder chosen, checked as the daemon will check it. */
function useUpload(onAdded: (id: string) => void) {
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
    if (first.size > MAX_UPLOAD) return setProblem(`${first.name} is ${(first.size / 1024 / 1024).toFixed(1)} MB; Stint takes at most 4 MB in one upload. Remove large files from it and try again.`);
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
  const onSubmit = () => {
    if (!picked) return;
    const form = new FormData();
    for (const f of picked.send) form.append('file', new Blob([f.bytes as Uint8Array<ArrayBuffer>]), f.path);
    form.append('source', JSON.stringify({ kind: picked.kind, ref: picked.ref } satisfies SkillSource));
    send(() => api.importSkill(form));
  };
  const submit: Submit = { why: !result ? 'Choose a file or folder first.' : result.blocked ? BLOCKED : null, label: 'Add skill', busy, failure, onSubmit };
  return { take, problem, result, submit, dirty: picked !== null };
}

function UploadTab({ u }: { u: ReturnType<typeof useUpload> }) {
  return (
    <div className="grid gap-4">
      <div
        className="grid gap-4 p-4 rounded-[5px] border border-dashed border-rule-strong"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void u.take([...e.dataTransfer.files], false);
        }}
        data-testid="skill-drop"
      >
        <p>Drop a .zip or a SKILL.md here, or choose one below.</p>
        <label className="stint-field-group">
          <span className="stint-field-label">A .zip or SKILL.md</span>
          <input type="file" accept=".zip,.md" className={fileField} onChange={(e) => void u.take([...(e.target.files ?? [])], false)} data-testid="skill-file" />
        </label>
        <label className="stint-field-group">
          <span className="stint-field-label">A folder that holds a SKILL.md</span>
          <input type="file" multiple {...{ webkitdirectory: '' }} className={fileField} onChange={(e) => void u.take([...(e.target.files ?? [])], true)} data-testid="skill-folder" />
        </label>
      </div>
      {u.problem ? (
        <p role="alert" className="stint-field-error">
          {u.problem}
        </p>
      ) : null}
      {u.result ? <Preview result={u.result} /> : null}
      <Refused failure={u.submit.failure} />
    </div>
  );
}

/** From git's draft: the URL, ref and path, as the command the CLI takes. */
function useGit() {
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
  return { url, setUrl, ref, setRef, path, setPath, copied, copy, given, ok, command, dirty: !!(given || ref.trim() || path.trim()) };
}

function GitTab({ g }: { g: ReturnType<typeof useGit> }) {
  return (
    <div className="grid gap-5">
      <div className="stint-field-group">
        <label htmlFor="git-url" className="stint-field-label">
          Repository URL
        </label>
        <input id="git-url" value={g.url} onChange={(e) => g.setUrl(e.target.value)} placeholder="https://example.com/acme/skills" className="stint-input font-mono" aria-invalid={(g.given && !g.ok) || undefined} aria-describedby="git-url-hint" />
        <p id="git-url-hint" className={g.given && !g.ok ? 'stint-field-error' : 'stint-field-help'}>
          {g.given && !g.ok ? 'The CLI clones https://, git@ and file:// URLs. Check how the URL starts.' : 'An https://, git@ or file:// URL.'}
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="stint-field-group">
          <span className="stint-field-label">Ref, if not the default branch</span>
          <input value={g.ref} onChange={(e) => g.setRef(e.target.value)} placeholder="main" className="stint-input font-mono" />
        </label>
        <label className="stint-field-group">
          <span className="stint-field-label">Path to the skill folder, if not the root</span>
          <input value={g.path} onChange={(e) => g.setPath(e.target.value)} placeholder="skills/widget-care" className="stint-input font-mono" />
        </label>
      </div>
      <Section title="Run this in a terminal in your project">
        <p className="mb-3 text-ink-2">The browser cannot fetch from git, so this command does. The skill then waits on this page with its findings.</p>
        <div className="flex items-start gap-2">
          <pre className="flex-1 min-w-0 font-mono text-code whitespace-pre-wrap break-all rounded-[5px] border border-rule bg-ground p-3" data-testid="git-command">
            {g.ok ? g.command : 'stint skills add <url>#<ref>:<path>'}
          </pre>
          <Button disabled={!g.ok} onClick={() => void g.copy()} data-testid="copy-git-command">
            Copy
          </Button>
        </div>
        <p aria-live="polite" className="mt-2 stint-field-help">
          {g.copied ?? ''}
        </p>
      </Section>
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

/** Write's draft: a new skill's fields, or on Edit the approved folder's, with the rest of the folder kept. */
function useWrite(edit: string | null, onAdded: (id: string) => void) {
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
  // the draft is dirty once it differs from where it started: empty, or the folder Edit read
  const draft = JSON.stringify([name, description, roles, tags, body]);
  const [start, setStart] = useState(draft);
  useEffect(() => {
    if (!edit) return;
    exportedFiles(edit)
      .then((files) => {
        const check = validateSkillBundle(files);
        const fm = check.frontmatter;
        const read = { description: fm?.description ?? '', roles: fm?.roles ?? [], tags: (fm?.tags ?? []).join(', '), body: check.body.trim() };
        if (fm) {
          // the name stays the folder's id, which is what approving writes into the frontmatter
          const { name: _n, description: _d, roles: _r, tags: _t, origin: _o, status: _s, source: _src, ...rest } = fm;
          setKept({ files: check.files.filter((f) => f.path !== 'SKILL.md'), fields: rest });
        }
        setDescription(read.description);
        setRoles(read.roles);
        setTags(read.tags);
        setBody(read.body);
        setStart(JSON.stringify([edit, read.description, read.roles, read.tags, read.body]));
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
  const onSubmit = () => send(() => api.importSkill({ files: files.map((f) => ({ path: f.path, base64: toBase64(f.bytes) })), source: { kind: 'editor', ref: 'the Skills page' }, id: fm.name }));
  const submit: Submit = { why: !ready ? 'Fill in the name and the description first.' : result?.blocked ? BLOCKED : null, label: edit ? 'Save the edit' : 'Add skill', busy, failure, onSubmit };
  return { name, setName, description, setDescription, roles, setRoles, tags, setTags, body, setBody, loading, loadError, result, tokens: countTokens(body), submit, dirty: draft !== start };
}

function WriteTab({ w, edit }: { w: ReturnType<typeof useWrite>; edit: string | null }) {
  if (w.loading) return <p className="text-ink-2">Reading {edit}.</p>;
  return (
    <div className="grid gap-5">
      {w.loadError ? (
        <p role="alert" className="stint-field-error">
          {w.loadError}
        </p>
      ) : null}
      <div className="stint-field-group">
        <label htmlFor="skill-name" className="stint-field-label">
          Name
        </label>
        <input id="skill-name" value={w.name} onChange={(e) => w.setName(e.target.value)} readOnly={!!edit} required maxLength={64} className="stint-input font-mono" aria-describedby="skill-name-hint" data-testid="skill-name" />
        <p id="skill-name-hint" className="stint-field-help">
          {edit ? 'The name stays the same; approving the edit replaces the skill and adds a version.' : 'Lowercase words joined by dashes, such as run-checks, at most 64 characters.'}
        </p>
      </div>
      <div className="stint-field-group">
        <label htmlFor="skill-description" className="stint-field-label">
          Description
        </label>
        <textarea id="skill-description" value={w.description} onChange={(e) => w.setDescription(e.target.value)} required maxLength={1024} rows={2} className="stint-input min-h-0" aria-describedby="skill-description-hint" data-testid="skill-description" />
        <p id="skill-description-hint" className="stint-field-help">
          When an agent should use it. This is the line every agent reads, so name the kind of task.
        </p>
      </div>
      <fieldset className="stint-field-group">
        <legend className="stint-field-label mb-2">Given to</legend>
        <div className="flex flex-wrap gap-4">
          {RoleSchema.options.map((r) => (
            <label key={r} className="inline-flex items-center gap-2 min-h-6">
              <input type="checkbox" checked={w.roles.includes(r)} onChange={(e) => w.setRoles((now) => (e.target.checked ? [...now, r] : now.filter((x) => x !== r)))} />
              {r}
            </label>
          ))}
        </div>
        <p className="stint-field-help">With none ticked, every role gets it.</p>
      </fieldset>
      <label className="stint-field-group">
        <span className="stint-field-label">Tags, comma separated</span>
        <input value={w.tags} onChange={(e) => w.setTags(e.target.value)} placeholder="limits, config" className="stint-input" />
      </label>
      <div className="stint-field-group">
        <label htmlFor="skill-body" className="stint-field-label">
          Instructions for the agent
        </label>
        <textarea id="skill-body" value={w.body} onChange={(e) => w.setBody(e.target.value)} rows={8} className="stint-input min-h-0 font-mono text-code" aria-describedby="skill-body-tokens" data-testid="skill-body" />
        <p id="skill-body-tokens" className={cx('stint-field-help tabular', w.tokens > SKILL_LIMITS.maxTokens ? 'text-red' : w.tokens > SKILL_LIMITS.warnTokens ? 'text-amber' : '')} data-testid="skill-body-tokens">
          About {w.tokens.toLocaleString('en')} tokens. Keep it under {SKILL_LIMITS.warnTokens.toLocaleString('en')}; write it from a real failure, and put detail in references/.
        </p>
      </div>
      {w.result ? <Preview result={w.result} /> : null}
      <Refused failure={w.submit.failure} />
    </div>
  );
}

type Tab = 'upload' | 'git' | 'write';
const TABS: Array<[Tab, string]> = [
  ['upload', 'Upload'],
  ['git', 'From git'],
  ['write', 'Write'],
];

/**
 * Open while mounted; mount it per use so each opening starts clean. `edit` opens Write on that skill. The dialog holds
 * every tab's draft, so switching tabs keeps what was typed or chosen, and a dismissal asks before it drops any of it.
 */
export function AddSkillDialog({ edit, onClose, onAdded }: { edit: string | null; onClose: () => void; onAdded: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>(edit ? 'write' : 'upload');
  const upload = useUpload(onAdded);
  const git = useGit();
  const write = useWrite(edit, onAdded);
  // From git only builds a command to copy, so it has nothing to submit
  const submit = tab === 'upload' ? upload.submit : tab === 'write' ? write.submit : null;
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  // after the dialog has noted the opener, so closing it gives focus back there
  useEffect(() => tabs.current[edit ? 'write' : 'upload']?.focus(), [edit]);
  return (
    <Dialog title={edit ? `Edit ${edit}` : 'Add skill'} open onClose={onClose} width={720} dirty={upload.dirty || git.dirty || write.dirty} footer={(dismiss) => <Actions submit={submit} dismiss={dismiss} />}>
      <div data-testid="add-skill-dialog">
        <p className="mb-4 text-small text-ink-3">It waits on the Skills page with its findings. No agent gets it until you approve it.</p>
        <div role="tablist" aria-label="How to add the skill" className="flex flex-wrap border-b border-rule mb-5" onKeyDown={tabKeys}>
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
              className={tabClass(tab === k)}
              data-testid={`add-skill-tab-${k}`}
            >
              {name}
            </button>
          ))}
        </div>
        {/* every panel stays mounted, so switching tabs keeps what was typed or chosen */}
        <div role="tabpanel" id="add-skill-panel-upload" aria-labelledby="add-skill-tab-upload" hidden={tab !== 'upload'}>
          <UploadTab u={upload} />
        </div>
        <div role="tabpanel" id="add-skill-panel-git" aria-labelledby="add-skill-tab-git" hidden={tab !== 'git'}>
          <GitTab g={git} />
        </div>
        <div role="tabpanel" id="add-skill-panel-write" aria-labelledby="add-skill-tab-write" hidden={tab !== 'write'}>
          <WriteTab w={write} edit={edit} />
        </div>
      </div>
    </Dialog>
  );
}
