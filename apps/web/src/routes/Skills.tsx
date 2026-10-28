import { type SkillFinding, type SkillSource, type StintEvent, scanSkillBundle } from '@stint-dev/core';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type Agent, DAEMON, YOU, agentOf, storyClock } from '../agents';
import { type SkillRecord, api, subscribe } from '../api';
import { AddSkillDialog, Findings, exportedFiles } from '../components/AddSkill';
import { shortName } from '../components/ApprovalGate';
import { Button, type ChipTone, EmptyState, StatusChip, Who, cx, rev } from '../components/ui';
import { money } from '../format';

const ORIGIN: Record<string, string> = { 'learn-loop': 'learned from reviews', human: 'written by a person', import: 'imported' };
const STATUSES = ['proposed', 'unreviewed', 'probation', 'active', 'retired'];
const SMALL = 'h-8 px-2.5 text-small';

/** Where an imported or written skill came from; a git source over https links to its repository. */
function Source({ source }: { source: SkillSource }) {
  const repo = source.kind === 'git' && source.ref.startsWith('https://') ? source.ref.split('#')[0] : null;
  return (
    <>
      {source.kind}:{' '}
      {repo ? (
        <a href={repo} target="_blank" rel="noreferrer" className="font-mono break-all underline underline-offset-2 hover:no-underline">
          {source.ref}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <span className="font-mono break-all">{source.ref}</span>
      )}
      {source.commit ? (
        <>
          , commit <span className="font-mono">{source.commit.slice(0, 12)}</span>
        </>
      ) : null}
    </>
  );
}

/** Amber where a skill needs you, violet while a learned one is on probation, red when its retirement is proposed. Active is plain ink: green means verified. */
const statusTone = (s: SkillRecord): ChipTone => (s.retireProposed ? 'bad' : s.status === 'active' ? 'active' : s.status === 'probation' ? 'learned' : s.status === 'proposed' || s.status === 'unreviewed' ? 'warn' : 'neutral');
const statusLabel = (s: SkillRecord) => (s.status === 'probation' ? 'on probation' : s.status);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The skill's record in a line: the runs it was mounted on, and the tasks it helped and hurt. */
function Track({ s }: { s: SkillRecord }) {
  return (
    <span className="tabular">
      {plural(s.appliedIn.length, 'run')}, {s.helped} helped
      {s.hurt ? <span className="text-red">, {s.hurt} hurt</span> : null}
    </span>
  );
}

const HISTORY = new Set(['skill.proposed', 'skill.imported', 'skill.edit_proposed', 'skill.unreviewed', 'skill.approved', 'skill.rejected', 'skill.status', 'skill.retire_proposed']);

/** Who a skill event names: the person, the daemon, or the model that drafted it. */
const byOf = (e: StintEvent): Agent => {
  const by = typeof e.payload.by === 'string' ? e.payload.by : null;
  if (e.type === 'skill.proposed') return agentOf('openai-compatible', String(e.payload.host ?? ''), String(e.payload.model ?? ''));
  if (e.type === 'skill.status' || e.type === 'skill.retire_proposed' || e.type === 'skill.unreviewed') return DAEMON;
  return !by || by === 'human' || by === 'you' ? YOU : { name: by, mark: 'other' };
};

/** One revision in words, as the task's revision block writes a run's change. */
function changeOf(e: StintEvent): string {
  const p = e.payload;
  const source = p.source as SkillSource | undefined;
  const findings = Array.isArray(p.findings) ? p.findings.length : 0;
  const scan = findings ? `, ${plural(findings, 'finding')}` : '';
  switch (e.type) {
    case 'skill.proposed': {
      const cost = (p.cost as { usd?: number } | undefined)?.usd;
      // T-0042/r4#F1 reads as T-0042 F1, the task and its finding
      const refs = Array.isArray(p.evidence) ? p.evidence.map((r) => String(r).replace(/\/r\d+#/, ' ')).join(' and ') : 'a review';
      return `Proposed from ${refs}${typeof cost === 'number' ? `, ${money({ usd: cost })}` : ''}`;
    }
    case 'skill.imported':
      return `Added from ${source ? `${source.kind} ${source.ref}` : 'a file'}${scan}`;
    case 'skill.edit_proposed':
      return `Edit proposed${source ? ` from ${source.kind}` : ''}${scan}`;
    case 'skill.unreviewed':
      return 'Arrived without a review';
    case 'skill.approved':
      return `Approved${typeof p.commit === 'string' ? ` in ${p.commit.slice(0, 7)}` : ''}`;
    case 'skill.rejected':
      return `Rejected${typeof p.reason === 'string' && p.reason ? `: ${p.reason}` : ''}`;
    case 'skill.status':
      return `${String(p.from)} to ${String(p.to)}, ${String(p.helped)} helped, ${String(p.hurt)} hurt`;
    default:
      return 'Retirement proposed';
  }
}

const when = (e: StintEvent) => storyClock(e.payload) ?? new Date(e.ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * A skill's version history as a revision block: each proposal, edit, approval and status change, with who made it. The
 * daemon keeps a skill's events on the first task of its evidence, or on the workspace log when no task carries them.
 */
function Revisions({ s }: { s: SkillRecord }) {
  const [events, setEvents] = useState<StintEvent[] | null>(null);
  // the evidence tasks carry a skill's events; with no evidence, the tasks it ran on carry its status changes
  // shortcut: only the 20 latest of those tasks are read, enough for one skill's history; page it if skills grow longer ones
  const carriers = s.evidence.length ? s.evidence : s.appliedIn.slice(-20);
  const tasks = [...new Set(carriers.map((ref) => ref.split('/')[0] as string))].join();
  useEffect(() => {
    let live = true;
    Promise.all([api.workspaceEvents().catch(() => []), ...(tasks ? tasks.split(',') : []).map((t) => api.events(t).catch(() => []))])
      .then((all) => {
        if (!live) return;
        const mine = all.flat().filter((e) => HISTORY.has(e.type) && e.payload.id === s.id);
        setEvents(mine.sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq));
      })
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, [s.id, tasks, s.status, s.stale, s.updateProposed, s.retireProposed]);
  return (
    // the heavy ink-3 line goes round the caption too, as on the task's revision block
    <div className="outline outline-ink-3">
      <table className={cx(rev.block, 'table-fixed')} data-testid="skill-revisions">
        <caption className={rev.caption}>Revisions</caption>
        <colgroup>
          <col className="w-16" />
          <col />
          <col className="w-[88px]" />
        </colgroup>
        <thead>
          <tr>
            {['When', 'Change', 'By'].map((h) => (
              <th key={h} scope="col" className={rev.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events === null || events.length === 0 ? (
            <tr>
              <td colSpan={3} className={cx(rev.td, 'text-ink-2')}>
                {events === null ? 'Reading the history.' : 'No change to it is on record yet. Each proposal, edit, approval and status change appears here.'}
              </td>
            </tr>
          ) : (
            events.map((e) => (
              <tr key={e.id} data-testid="skill-revision">
                <td className={cx(rev.td, 'font-mono tabular text-ink-2')}>{when(e)}</td>
                <td className={cx(rev.td, 'break-words', e.type === 'skill.rejected' && 'text-red', (e.type === 'skill.unreviewed' || e.type === 'skill.edit_proposed') && 'text-amber')}>{changeOf(e)}</td>
                <td className={cx(rev.td, 'overflow-hidden')} title={byOf(e).name}>
                  <Who agent={{ ...byOf(e), name: shortName(byOf(e).name) }} className="max-w-full font-semibold" />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SkillRow({ s, onChange, onEdit }: { s: SkillRecord; onChange: () => void; onEdit: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [acked, setAcked] = useState<ReadonlySet<number>>(new Set());
  const [scanned, setScanned] = useState<SkillFinding[] | null>(null);
  // the daemon scans what is imported; a folder that arrived on its own is scanned here, from its export
  useEffect(() => {
    if (s.status !== 'unreviewed') return;
    exportedFiles(s.id)
      .then((files) => setScanned(scanSkillBundle(files)))
      .catch(() => setScanned(null));
  }, [s.id, s.status]);
  const review = s.status === 'proposed' || s.status === 'unreviewed' || !!s.updateProposed;
  const findings = s.findings ?? scanned;
  const warns = (findings ?? []).flatMap((f, i) => (f.severity === 'warn' ? [i] : []));
  const warnIds = [...new Set(warns.map((i) => (findings as SkillFinding[])[i]?.id as string))];
  const blocked = (findings ?? []).some((f) => f.severity === 'block');
  const waiting = warns.some((i) => !acked.has(i));
  const hasFolder = s.status !== 'proposed';
  const act = (fn: () => Promise<unknown>) => {
    setError(null);
    fn()
      .then(onChange)
      .catch((e: unknown) => setError(`That did not go through: ${e instanceof Error ? e.message : String(e)}`));
  };
  const titleId = `skill-title-${s.id}`;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 min-w-0 p-5 rounded-[5px] border border-rule bg-panel" data-testid="skill-row" data-skill={s.id} data-origin={s.origin}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={titleId} className="font-mono text-section break-all">
            {s.id}
          </h2>
          <span className="flex flex-wrap gap-2">
            {s.stale ? <StatusChip label="changed since approved" tone="warn" /> : null}
            {s.retireProposed ? <StatusChip label="retirement proposed" tone="bad" /> : null}
            <StatusChip label={statusLabel(s)} tone={statusTone(s)} />
          </span>
        </div>
        <p>{s.description}</p>
      </div>
      <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-small">
        <dt className="text-ink-2">Where from</dt>
        <dd className="m-0" data-testid="skill-origin">
          <span className="inline-block first-letter:uppercase">{ORIGIN[s.origin] ?? s.origin}</span>
        </dd>
        {s.source ? (
          <>
            <dt className="text-ink-2">Source</dt>
            <dd className="m-0" data-testid="skill-source">
              <Source source={s.source} />
            </dd>
          </>
        ) : null}
        <dt className="text-ink-2">Given to</dt>
        <dd className="m-0">
          <span className="inline-block first-letter:uppercase">{s.roles.length ? s.roles.join(', ') : 'every role'}</span>
          {s.tags.length ? (
            <>
              , on tasks tagged <span className="font-mono">{s.tags.join(', ')}</span>
            </>
          ) : null}
        </dd>
        {s.evidence.length ? (
          <>
            <dt className="text-ink-2">Evidence</dt>
            <dd className="m-0 flex flex-wrap gap-x-3">
              {s.evidence.map((e) => (
                <Link key={e} to={`/t/${e.split('/')[0]}?tab=review`} className="font-mono underline decoration-rule-strong hover:decoration-ink">
                  {e}
                </Link>
              ))}
            </dd>
          </>
        ) : null}
        <dt className="text-ink-2">Track record</dt>
        <dd className="m-0 tabular" data-testid="skill-track">
          {/* sentence case on screen; the words stay as the tests and the CLI name them */}
          <span className="inline-block first-letter:uppercase">
            {s.appliedIn.length ? `applied in ${plural(s.appliedIn.length, 'run')}, helped ${plural(s.helped, 'task')}, hurt ${plural(s.hurt, 'task')}` : 'not applied yet'}
          </span>
        </dd>
        <dt className="text-ink-2">Eval</dt>
        <dd className="m-0 tabular" data-testid="skill-eval">
          <span className="inline-block first-letter:uppercase">{s.eval ? `${s.eval.card}${s.eval.synthetic ? ' (synthetic recording)' : ''}` : 'not evaluated'}</span>
        </dd>
      </dl>
      <Revisions s={s} />
      {s.retireProposed ? (
        <div className="flex flex-col gap-2 rounded-[5px] border border-red bg-red-wash px-3 py-3" data-testid="retire-proposal">
          <p>
            Retirement proposed: this skill hurt more tasks than it helped (helped {s.helped}, hurt {s.hurt}). Retiring stops it mounting; keeping it clears the proposal until the record changes.
          </p>
          <div className="flex gap-2">
            <Button className={SMALL} tone="danger" onClick={() => act(() => api.retireSkill(s.id))} data-testid="retire-skill">
              Retire
            </Button>
            <Button className={SMALL} onClick={() => act(() => api.keepSkill(s.id))} data-testid="keep-skill">
              Keep
            </Button>
          </div>
        </div>
      ) : null}
      {review ? (
        <div className="flex flex-col gap-3" data-testid="skill-review">
          {s.updateProposed ? <p>An update to this skill waits for review. The approved version keeps mounting until you approve it.</p> : null}
          {s.status === 'unreviewed' ? <p>This folder arrived without a review, by a merge, a pull or a copy. It does not mount until you approve it.</p> : null}
          {findings ? (
            <Findings
              findings={findings}
              acked={acked}
              onAck={(i, on) =>
                setAcked((now) => {
                  const next = new Set(now);
                  on ? next.add(i) : next.delete(i);
                  return next;
                })
              }
            />
          ) : null}
        </div>
      ) : null}
      {review ? (
        rejecting ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => api.rejectSkill(s.id, reason));
            }}
          >
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label={`Why reject ${s.id}`}
              placeholder="Why not? The same evidence will not raise it again."
              className="flex-1 min-w-[200px] h-9 rounded-[5px] border border-field bg-ground px-2.5 text-ink placeholder:text-ink-3"
            />
            <Button tone="danger" type="submit">
              Reject
            </Button>
            <Button onClick={() => setRejecting(false)}>Cancel</Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="primary" disabled={blocked || waiting} aria-describedby={blocked || waiting ? `approve-why-${s.id}` : undefined} onClick={() => act(() => api.approveSkill(s.id, warnIds))} data-testid="approve-skill">
              Approve and commit
            </Button>
            <Button onClick={() => setRejecting(true)}>Reject</Button>
            {blocked || waiting ? (
              <span id={`approve-why-${s.id}`} className="text-small text-ink-2" data-testid="approve-why">
                {blocked ? 'Approve is off: a block finding stops this skill. Fix the bundle and add it again.' : 'Approve waits until every warning is ticked.'}
              </span>
            ) : null}
          </div>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 border-t border-rule">
        {hasFolder ? (
          <span className="flex gap-2">
            <a
              href={api.exportSkillUrl(s.id)}
              download={`${s.id}.zip`}
              aria-label={`Download ${s.id} as a zip`}
              className="inline-flex items-center h-8 px-2.5 rounded-[5px] border border-rule-strong text-small font-medium text-ink no-underline hover:border-ink-2 hover:bg-panel-2"
              data-testid="download-skill"
            >
              Download
            </a>
            <Button className={SMALL} onClick={onEdit} aria-label={`Edit ${s.id}`} data-testid="edit-skill">
              Edit
            </Button>
          </span>
        ) : (
          <span className="text-small text-ink-2">Download and Edit open once it is approved.</span>
        )}
        <span className="font-mono text-small text-ink-3 break-all">{review ? `stint skills approve ${s.id}${warnIds.length ? ` --ack ${warnIds.join(',')}` : ''}` : 'stint skills list'}</span>
      </div>
      {error ? (
        <p role="alert" className="text-red">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const NUMBER = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number, word: string) => `${NUMBER[n] ?? n} ${word}${n === 1 ? '' : 's'}`;
/** The list's columns, as the design sets them: the skill, where it came from, and its track record. */
const COLUMNS = 'grid grid-cols-[minmax(0,1fr)] min-[1000px]:grid-cols-[minmax(0,1fr)_132px_120px] gap-x-3 gap-y-2';

export function Skills() {
  const [skills, setSkills] = useState<SkillRecord[] | null>(null);
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState<{ edit: string | null } | null>(null);
  const load = useCallback(() => {
    api
      .skills()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);
  useEffect(load, [load]);
  // a skill proposed, approved or retired anywhere (the queue, the CLI, autopilot) shows here without a reload
  useEffect(() => subscribe('/api/stream', (e) => e.type.startsWith('skill.') && load(), load), [load]);
  const order = (s: SkillRecord) => (s.status === 'proposed' ? 0 : s.retireProposed ? 1 : s.status === 'probation' ? 2 : s.status === 'active' ? 3 : 4);
  const sorted = [...(skills ?? [])].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  const origin = params.get('origin') ?? '';
  const status = params.get('status') ?? '';
  const shown = sorted.filter((s) => (!origin || s.origin === origin) && (!status || s.status === status));
  // what needs a decision comes first, and is what the page opens on
  const selected = shown.find((s) => s.id === params.get('skill')) ?? shown[0] ?? null;
  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (value) n.set(key, value);
        else n.delete(key);
        return n;
      },
      { replace: true },
    );
  const pick = (id: string) => setParam('skill', id);
  const select = 'h-9 rounded-[5px] border border-field bg-ground px-2 text-ink';
  const learned = sorted.filter((s) => s.origin === 'learn-loop').length;
  const written = sorted.length - learned;
  return (
    <main className="relative flex-1 min-h-0 overflow-y-auto" data-testid="skills">
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-5 pb-8 md:pt-7 md:pb-10 flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5 max-w-[75ch] min-w-0">
            <h1 className="text-title">Skills</h1>
            <p className="text-ink-2">
              {skills === null
                ? 'Reading the skills from the daemon.'
                : sorted.length
                  ? `What every agent is told before it starts: ${count(sorted.length, 'skill')}, ${learned ? `${NUMBER[learned] ?? learned} learned` : 'none learned yet'}. Nothing mounts until you approve it.`
                  : 'No skill is mounted yet. Nothing mounts until you approve it.'}
            </p>
          </div>
          <Button onClick={() => setAdding({ edit: null })} data-testid="add-skill">
            Add skill
          </Button>
        </header>
        <details className="text-ink-2 max-w-[75ch]">
          <summary className="cursor-pointer hover:text-ink">
            How a skill is learned and mounted
          </summary>
          <p className="mt-2">
            Each skill is a folder in <span className="font-mono">.agents/skills/</span>, mounted by role and tag before every run. When a review finding recurs across tasks, the learn step proposes a skill with its evidence; nothing is written until you approve it. A learned skill starts on probation and becomes active after it helps on three tasks; one that hurts more than it helps is proposed for retirement.{' '}
            {written ? `${NUMBER[written] ?? written} ${written === 1 ? 'was' : 'were'} written by a person.` : ''}
          </p>
        </details>
        {skills?.length === 0 ? <EmptyState>No skills yet. A skill appears here when a review finding recurs across two tasks, or when a file is added to .agents/skills.</EmptyState> : null}
        {sorted.length ? (
          <div role="group" aria-label="Filter the list" className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-small text-ink-2">
              Where from
              <select value={origin} onChange={(e) => setParam('origin', e.target.value)} className={select} data-testid="filter-origin">
                <option value="">All</option>
                {Object.entries(ORIGIN).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-small text-ink-2">
              Status
              <select value={status} onChange={(e) => setParam('status', e.target.value)} className={select} data-testid="filter-status">
                <option value="">All</option>
                {STATUSES.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {sorted.length && !shown.length ? <EmptyState testId="skills-filter-empty">No skill matches this filter. Set both back to All to see every skill.</EmptyState> : null}
        {shown.length ? (
          <div className="grid gap-6 items-start min-[1000px]:grid-cols-[minmax(0,1fr)_440px]">
            <section aria-labelledby="skills-list-title" className="min-w-0 flex flex-col">
              <h2 id="skills-list-title" className="sr-only">
                Skill list
              </h2>
              <div aria-hidden="true" className={cx(COLUMNS, 'hidden min-[1000px]:grid px-3 pb-2 text-small text-ink-2 border-b border-rule-strong')}>
                <span>Skill</span>
                <span>Origin</span>
                <span>Track record</span>
              </div>
              <ul>
                {shown.map((s) => (
                  <li key={s.id} data-testid="skill-list-row" data-list-skill={s.id}>
                    <button
                      type="button"
                      aria-current={s.id === selected?.id ? 'true' : undefined}
                      onClick={() => pick(s.id)}
                      className={cx(COLUMNS, 'w-full items-center min-h-[60px] px-3 py-2.5 border-b border-rule text-left', s.id === selected?.id ? 'bg-panel shadow-[inset_0_0_0_1px_var(--rule-strong)]' : 'hover:bg-panel')}
                    >
                      <span className="flex flex-col gap-0.5 min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[14px] leading-5 break-all">{s.id}</span>
                          <StatusChip label={s.retireProposed ? 'retirement proposed' : statusLabel(s)} tone={statusTone(s)} />
                        </span>
                        <span className="text-small text-ink-2 line-clamp-2">{s.description}</span>
                      </span>
                      <span className={cx('text-small', s.stale ? 'text-amber' : 'text-ink')}>
                        <span className="inline-block first-letter:uppercase">{ORIGIN[s.origin] ?? s.origin}</span>
                        {s.stale ? ', changed since approved' : ''}
                      </span>
                      <span className="text-small">
                        <Track s={s} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="pt-3 max-w-[75ch] text-small text-ink-2">
                Helped means a task with the skill mounted was approved with no repeat of the finding it came from. Proposals also wait in the queue on the Factory.
              </p>
            </section>
            {selected ? <SkillRow key={selected.id} s={selected} onChange={load} onEdit={() => setAdding({ edit: selected.id })} /> : null}
          </div>
        ) : null}
      </div>
      {adding ? (
        <AddSkillDialog
          edit={adding.edit}
          onClose={() => setAdding(null)}
          onAdded={(id) => {
            setAdding(null);
            load();
            pick(id);
          }}
        />
      ) : null}
    </main>
  );
}
