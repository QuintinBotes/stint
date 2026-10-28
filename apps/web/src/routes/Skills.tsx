import { type SkillFinding, type SkillSource, scanSkillBundle } from '@stint-dev/core';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type SkillRecord, api, subscribe } from '../api';
import { AddSkillDialog, Findings, exportedFiles } from '../components/AddSkill';
import { Button, type ChipTone, EmptyState, StatusChip, Swatch, cx } from '../components/ui';

const ORIGIN: Record<string, string> = { 'learn-loop': 'learned from reviews', human: 'written by a person', import: 'imported' };
const STATUSES = ['proposed', 'unreviewed', 'probation', 'active', 'retired'];

/** Where an imported or written skill came from; a git source over https links to its repository. */
function Source({ source }: { source: SkillSource }) {
  const repo = source.kind === 'git' && source.ref.startsWith('https://') ? source.ref.split('#')[0] : null;
  return (
    <>
      {source.kind}:{' '}
      {repo ? (
        <a href={repo} target="_blank" rel="noreferrer" className="font-mono text-[12px] break-all underline underline-offset-2 hover:no-underline">
          {source.ref}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <span className="font-mono text-[12px] break-all">{source.ref}</span>
      )}
      {source.commit ? (
        <>
          , commit <span className="font-mono text-[12px]">{source.commit.slice(0, 12)}</span>
        </>
      ) : null}
    </>
  );
}

const statusTone = (s: SkillRecord): ChipTone => (s.retireProposed ? 'bad' : s.status === 'active' ? 'good' : s.status === 'probation' ? 'learned' : s.status === 'proposed' ? 'warn' : 'neutral');

/** Where a rule came from, as a flag with its word: learned in purple, changed since approval in yellow, written by you in grey. */
function Origin({ s }: { s: SkillRecord }) {
  const learned = s.origin === 'learn-loop';
  return (
    <span className={cx('inline-flex items-center gap-2 text-[12px]', s.stale ? 'text-yellow' : learned ? 'text-purple' : 'text-ink-2')}>
      <Swatch tone={s.stale ? 'warn' : learned ? 'learned' : 'neutral'} />
      {ORIGIN[s.origin] ?? s.origin}
      {s.stale ? ', changed since approved' : ''}
    </span>
  );
}

/** One dot per run the rule was given to: filled for a task it helped, red for one it hurt, hollow while there is no verdict. */
function Track({ s }: { s: SkillRecord }) {
  const total = Math.min(12, Math.max(s.appliedIn.length, s.helped + s.hurt));
  return (
    <span aria-hidden="true" className="flex flex-wrap gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the dots are counts, in order
          key={i}
          className="inline-block size-2.5 rounded-full"
          style={i < s.helped ? { background: 'var(--ink)' } : i < s.helped + s.hurt ? { background: 'var(--sw-red)' } : { boxShadow: 'inset 0 0 0 1.5px var(--ink-3)' }}
        />
      ))}
    </span>
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
  return (
    <li className="flex flex-col gap-4" data-testid="skill-row" data-skill={s.id} data-origin={s.origin}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-mono text-[14px] font-medium break-all">{s.id}</h2>
        <span className="flex flex-wrap gap-3">
          {s.stale ? <StatusChip label="changed since approved" tone="warn" /> : null}
          {s.retireProposed ? <StatusChip label="retirement proposed" tone="bad" /> : null}
          <StatusChip label={s.status === 'active' || s.status === 'probation' ? `${s.status}, given to drivers` : s.status} tone={statusTone(s)} />
        </span>
      </div>
      <p className="px-4 py-4 bg-panel border-t-2 border-ink text-[14px] leading-[25px]">{s.description}</p>
      <dl className="m-0 grid grid-cols-[100px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px] leading-5">
        <dt className="text-ink-2">Where from</dt>
        <dd className="m-0" data-testid="skill-origin">
          {ORIGIN[s.origin] ?? s.origin}
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
          {s.roles.length ? s.roles.join(', ') : 'every role'}
          {s.tags.length ? `, on tasks tagged ${s.tags.join(', ')}` : ''}
        </dd>
        {s.evidence.length ? (
          <>
            <dt className="text-ink-2">Evidence</dt>
            <dd className="m-0 flex flex-wrap gap-x-3">
              {s.evidence.map((e) => (
                <Link key={e} to={`/t/${e.split('/')[0]}?tab=review`} className="font-mono text-[12px] underline-offset-2 hover:underline">
                  {e}
                </Link>
              ))}
            </dd>
          </>
        ) : null}
        <dt className="text-ink-2">Track record</dt>
        <dd className="m-0 tabular" data-testid="skill-track">
          {s.appliedIn.length
            ? `applied in ${s.appliedIn.length} run${s.appliedIn.length === 1 ? '' : 's'}, helped ${s.helped} task${s.helped === 1 ? '' : 's'}, hurt ${s.hurt} task${s.hurt === 1 ? '' : 's'}`
            : 'not applied yet'}
        </dd>
        <dt className="text-ink-2">Eval</dt>
        <dd className="m-0 tabular" data-testid="skill-eval">
          {s.eval ? `${s.eval.card}${s.eval.synthetic ? ' (synthetic recording)' : ''}` : 'not evaluated'}
        </dd>
      </dl>
      {s.retireProposed ? (
        <div className="flex flex-col gap-2 px-4 py-3 bg-removed border-t-2 border-red" data-testid="retire-proposal">
          <p className="text-[14px]">
            Retirement proposed: this skill hurt more tasks than it helped (helped {s.helped}, hurt {s.hurt}). Retiring stops it mounting; keeping it clears the proposal until the record changes.
          </p>
          <div className="flex gap-2">
            <Button tone="danger" onClick={() => act(() => api.retireSkill(s.id))} data-testid="retire-skill">
              Retire
            </Button>
            <Button onClick={() => act(() => api.keepSkill(s.id))} data-testid="keep-skill">
              Keep
            </Button>
          </div>
        </div>
      ) : null}
      {review ? (
        <div className="flex flex-col gap-3" data-testid="skill-review">
          {s.updateProposed ? <p className="text-[14px]">An update to this skill waits for review. The approved version keeps mounting until you approve it.</p> : null}
          {s.status === 'unreviewed' ? <p className="text-[14px]">This folder arrived without a review, by a merge, a pull or a copy. It does not mount until you approve it.</p> : null}
          {findings ? <Findings findings={findings} acked={acked} onAck={(i, on) => setAcked((now) => { const next = new Set(now); on ? next.add(i) : next.delete(i); return next; })} /> : null}
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
              className="flex-1 min-w-[200px] h-8 rounded-[3px] border border-rule-strong bg-ground px-2 text-[12px] text-ink placeholder:text-ink-3"
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
              <span id={`approve-why-${s.id}`} className="text-[14px] text-ink-2" data-testid="approve-why">
                {blocked ? 'Approve is off: a block finding stops this skill. Fix the bundle and add it again.' : 'Approve waits until every warning is ticked.'}
              </span>
            ) : null}
          </div>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-rule">
        {hasFolder ? (
          <span className="flex gap-2">
            <a href={api.exportSkillUrl(s.id)} download={`${s.id}.zip`} aria-label={`Download ${s.id} as a zip`} className="inline-flex items-center h-8 px-3 rounded-[3px] border border-ink-3 text-[14px] font-semibold text-ink no-underline hover:border-ink" data-testid="download-skill">
              Download
            </a>
            <Button onClick={onEdit} aria-label={`Edit ${s.id}`} data-testid="edit-skill">
              Edit
            </Button>
          </span>
        ) : (
          <span className="text-[14px] text-ink-2">Download and Edit open once it is approved.</span>
        )}
        <span className="font-mono text-[12px] text-ink-3 break-all">{review ? `stint skills approve ${s.id}${warnIds.length ? ` --ack ${warnIds.join(',')}` : ''}` : 'stint skills list'}</span>
      </div>
      {error ? <p className="text-[14px] text-red">{error}</p> : null}
    </li>
  );
}

const NUMBER = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number, word: string) => `${NUMBER[n] ?? n} ${word}${n === 1 ? '' : 's'}`;

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
  const select = 'h-8 rounded-[3px] border border-ink-3 bg-ground px-2 text-[14px] text-ink';
  const learned = sorted.filter((s) => s.origin === 'learn-loop').length;
  const written = sorted.length - learned;
  return (
    <main className="relative flex-1 min-h-0 overflow-y-auto" data-testid="skills">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 pt-8 pb-8 flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <h1 className="text-[19px] leading-6 sm:text-[34px] sm:leading-10 font-bold stretch-112 tracking-[-0.02em] [text-wrap:balance]">
            {skills === null ? 'Reading what every driver is told.' : sorted.length ? `What every driver is told: ${count(sorted.length, 'skill')}, ${learned ? `${NUMBER[learned] ?? learned} learned` : 'none learned yet'}.` : 'Nothing is on the setup sheet yet.'}
          </h1>
          <Button onClick={() => setAdding({ edit: null })} data-testid="add-skill">
            Add skill
          </Button>
        </header>
        <details className="text-[14px] text-ink-2 max-w-[75ch]">
          <summary className="cursor-pointer hover:text-ink">
            Folders in <span className="font-mono text-[12px]">.agents/skills/</span>, mounted by role before every run. How a skill is learned
          </summary>
          <p className="mt-2">
            When a review finding recurs across tasks, the learn step proposes a skill with its evidence; nothing is written until you approve it. A learned skill starts on probation and becomes active after it helps on three tasks; one that hurts more than it helps is proposed for retirement. {written ? `${NUMBER[written] ?? written} ${written === 1 ? 'was' : 'were'} written by a person.` : ''}
          </p>
        </details>
        {skills === null ? <p className="text-ink-3">Reading the skills.</p> : null}
        {skills?.length === 0 ? <EmptyState>No skills yet. A skill appears here when a review finding recurs across two tasks, or when a file is added to .agents/skills.</EmptyState> : null}
        {sorted.length ? (
          <div role="group" aria-label="Filter the list" className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-[14px] text-ink-2">
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
            <label className="flex items-center gap-2 text-[14px] text-ink-2">
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
          <div className="flex flex-wrap gap-8 items-start">
            <section aria-label="Rules" className="flex-[1_1_620px] min-w-0 flex flex-col border-t-2 border-ink">
              <ul>
                {shown.map((s) => (
                  <li key={s.id} data-testid="skill-list-row" data-list-skill={s.id}>
                    <button
                      type="button"
                      aria-current={s.id === selected?.id ? 'true' : undefined}
                      onClick={() => pick(s.id)}
                      className={cx('w-full grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_120px_150px] gap-x-4 gap-y-2 items-center px-3 py-4 border-b border-rule text-left hover:bg-panel', s.id === selected?.id && 'bg-panel')}
                    >
                      <span className="flex flex-col gap-1 min-w-0">
                        <span className="font-mono text-[14px] break-all">{s.id}</span>
                        <span className="text-[12px] leading-5 text-ink-2">{s.description}</span>
                        <Origin s={s} />
                      </span>
                      <span className="hidden md:flex flex-col gap-1 text-[12px] text-ink-2">
                        <span>Given to</span>
                        <span className="text-[14px] font-bold text-ink">{s.roles.length ? s.roles.join(', ') : 'every role'}</span>
                      </span>
                      <span className="flex flex-col gap-2 text-[12px] text-ink-2">
                        <StatusChip label={s.retireProposed ? 'retire?' : s.status} tone={statusTone(s)} />
                        <span className="tabular">
                          {s.appliedIn.length} run{s.appliedIn.length === 1 ? '' : 's'}, helped {s.helped}
                        </span>
                        <Track s={s} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="px-3 pt-3 max-w-[60ch] text-[12px] leading-4 text-ink-2">
                Each dot is a run the rule was given to: filled for a task it helped, red for one it hurt, hollow while there is no verdict. Helped means a task with the skill mounted was approved with no repeat of the finding it came from. Proposals also wait with the stewards on the Standings.
              </p>
            </section>
            {selected ? (
              <section aria-label="Rule detail" className="flex-[1_1_460px] min-w-0">
                <ul>
                  <SkillRow key={selected.id} s={selected} onChange={load} onEdit={() => setAdding({ edit: selected.id })} />
                </ul>
              </section>
            ) : null}
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
