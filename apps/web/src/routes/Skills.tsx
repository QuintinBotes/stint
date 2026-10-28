import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type SkillRecord, api, subscribe } from '../api';
import { Button, type ChipTone, EmptyState, StatusChip, Swatch, cx } from '../components/ui';

const ORIGIN: Record<string, string> = { 'learn-loop': 'learned from reviews', human: 'written by a person' };

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

function SkillRow({ s, onChange }: { s: SkillRecord; onChange: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => {
    setError(null);
    fn()
      .then(onChange)
      .catch((e: unknown) => setError(`That did not go through: ${e instanceof Error ? e.message : String(e)}`));
  };
  return (
    <li className="flex flex-col gap-4" data-testid="skill-row" data-skill={s.id}>
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
        <dd className="m-0">{ORIGIN[s.origin] ?? s.origin}</dd>
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
        {s.eval ? (
          <>
            <dt className="text-ink-2">Eval</dt>
            <dd className="m-0 tabular" data-testid="skill-eval">
              {s.eval.card}
              {s.eval.synthetic ? ' (synthetic recording)' : ''}
            </dd>
          </>
        ) : null}
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
      {s.status === 'proposed' ? (
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
            <Button tone="primary" onClick={() => act(() => api.approveSkill(s.id))} data-testid="approve-skill">
              Approve and commit
            </Button>
            <Button onClick={() => setRejecting(true)}>Reject</Button>
          </div>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-rule">
        <span className="font-mono text-[12px] text-ink-3">{s.status === 'proposed' ? `stint skills approve ${s.id}` : 'stint skills list'}</span>
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
  // what needs a decision comes first, and is what the page opens on
  const selected = sorted.find((s) => s.id === params.get('skill')) ?? sorted[0] ?? null;
  const pick = (id: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('skill', id);
        return n;
      },
      { replace: true },
    );
  const learned = sorted.filter((s) => s.origin === 'learn-loop').length;
  const written = sorted.length - learned;
  return (
    <main className="relative flex-1 min-h-0 overflow-y-auto" data-testid="skills">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 pt-8 pb-8 flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <h1 className="text-[19px] leading-6 sm:text-[34px] sm:leading-10 font-bold stretch-112 tracking-[-0.02em] [text-wrap:balance]">
            {skills === null ? 'Reading what every driver is told.' : sorted.length ? `What every driver is told: ${count(sorted.length, 'skill')}, ${learned ? `${NUMBER[learned] ?? learned} learned` : 'none learned yet'}.` : 'Nothing is on the setup sheet yet.'}
          </h1>
          {/* R-060's "Add skill" button goes here */}
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
          <div className="flex flex-wrap gap-8 items-start">
            <section aria-label="Rules" className="flex-[1_1_620px] min-w-0 flex flex-col border-t-2 border-ink">
              <ul>
                {sorted.map((s) => (
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
                  <SkillRow key={selected.id} s={selected} onChange={load} />
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
