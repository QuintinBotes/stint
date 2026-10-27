import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type SkillRecord, api, subscribe } from '../api';
import { Button, EmptyState, StatusChip, cx } from '../components/ui';

const ORIGIN: Record<string, string> = { 'learn-loop': 'learned from reviews', human: 'written by a person' };

function SkillRow({ s, onChange }: { s: SkillRecord; onChange: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => {
    setError(null);
    fn()
      .then(onChange)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <li className="rounded-lg border border-line bg-raised p-4" data-testid="skill-row" data-skill={s.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-mono text-[13px] font-semibold">{s.id}</h2>
          <p className="text-[13px] text-ink mt-1 max-w-[72ch]">{s.description}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {s.stale ? <StatusChip label="changed since approved" tone="warn" /> : null}
          {s.retireProposed ? <StatusChip label="retirement proposed" tone="bad" /> : null}
          <StatusChip label={s.status} tone={s.status === 'active' ? 'good' : s.status === 'probation' ? 'active' : s.status === 'proposed' ? 'warn' : 'neutral'} />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-muted">Origin</dt>
        <dd>{ORIGIN[s.origin] ?? s.origin}</dd>
        <dt className="text-muted">Loads for</dt>
        <dd>{s.roles.length ? s.roles.join(', ') : 'every role'}{s.tags.length ? `, on tasks tagged ${s.tags.join(', ')}` : ''}</dd>
        {s.evidence.length ? (
          <>
            <dt className="text-muted">Evidence</dt>
            <dd className="flex flex-wrap gap-x-3">
              {s.evidence.map((e) => (
                <Link key={e} to={`/t/${e.split('/')[0]}?tab=review`} className="font-mono hover:text-accent">
                  {e}
                </Link>
              ))}
            </dd>
          </>
        ) : null}
        <dt className="text-muted">Track record</dt>
        <dd className="tabular" data-testid="skill-track">
          {s.appliedIn.length
            ? `applied in ${s.appliedIn.length} run${s.appliedIn.length === 1 ? '' : 's'}, helped ${s.helped} task${s.helped === 1 ? '' : 's'}, hurt ${s.hurt} task${s.hurt === 1 ? '' : 's'}`
            : 'not applied yet'}
        </dd>
        {s.eval ? (
          <>
            <dt className="text-muted">Eval</dt>
            <dd className="tabular" data-testid="skill-eval">
              {s.eval.card}
              {s.eval.synthetic ? ' (synthetic recording)' : ''}
            </dd>
          </>
        ) : null}
      </dl>
      {s.retireProposed ? (
        <div className="mt-3 rounded-md border border-bad/40 bg-bad-tint p-3" data-testid="retire-proposal">
          <p className="text-[13px]">
            Retirement proposed: this skill hurt more tasks than it helped (helped {s.helped}, hurt {s.hurt}). Retiring stops it mounting; keeping it clears the proposal until the record changes.
          </p>
          <div className="mt-2 flex gap-2">
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
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => api.rejectSkill(s.id, reason));
            }}
          >
            <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why not? The same evidence will not raise it again." className="flex-1 h-8 rounded-md border border-line bg-surface px-2 text-[13px]" />
            <Button tone="danger" type="submit">
              Reject
            </Button>
            <Button onClick={() => setRejecting(false)}>Cancel</Button>
          </form>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button tone="primary" onClick={() => act(() => api.approveSkill(s.id))} data-testid="approve-skill">
              Approve and commit
            </Button>
            <Button onClick={() => setRejecting(true)}>Reject</Button>
          </div>
        )
      ) : null}
      {error ? <p className="mt-2 text-[12px] text-bad">{error}</p> : null}
    </li>
  );
}

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
  const pick = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('skill', id); return n; }, { replace: true });
  return (
    <main className="flex-1 min-h-0 overflow-y-auto" data-testid="skills">
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        <header className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.02em]">Skills</h1>
            <p className="text-muted text-[13px] mt-1 max-w-[90ch]">
              Folders in <span className="font-mono">.agents/skills/</span>, mounted by role before every run. When a review finding recurs across tasks, the learn step proposes one with its evidence; nothing is written until you approve it. A learned skill starts on probation and becomes active after it helps on three tasks; one that hurts more than it helps is proposed for retirement.
            </p>
          </div>
          <span className="font-mono text-[12px] text-faint">stint skills list</span>
        </header>
        {skills === null ? <p className="text-faint">Reading the skills.</p> : null}
        {skills?.length === 0 ? <EmptyState>No skills yet. A skill appears here when a review finding recurs across two tasks, or when a file is added to .agents/skills.</EmptyState> : null}
        {sorted.length ? (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start">
            <div className="rounded-lg border border-line bg-raised overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="text-[12px] text-muted text-left">
                  <tr className="border-b border-line">
                    <th className="font-normal px-3 py-2">Skill</th>
                    <th className="font-normal px-3 py-2">Origin</th>
                    <th className="font-normal px-3 py-2 hidden md:table-cell">Roles</th>
                    <th className="font-normal px-3 py-2">Status</th>
                    <th className="font-normal px-3 py-2 text-right">Applied, helped</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s) => (
                    <tr key={s.id} data-testid="skill-list-row" data-list-skill={s.id} aria-selected={s.id === selected?.id} className={cx('border-b border-line last:border-0 cursor-pointer', s.id === selected?.id ? 'bg-sunken' : 'hover:bg-sunken/60')} onClick={() => pick(s.id)}>
                      <td className="px-3 py-2">
                        <button type="button" className="font-mono text-left hover:text-accent focus-visible:text-accent" onClick={() => pick(s.id)}>
                          {s.id}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-muted">{ORIGIN[s.origin] ?? s.origin}</td>
                      <td className="px-3 py-2 text-muted hidden md:table-cell">{s.roles.length ? s.roles.join(', ') : 'every role'}</td>
                      <td className="px-3 py-2">
                        <StatusChip label={s.retireProposed ? 'retire?' : s.status} tone={s.status === 'active' ? 'good' : s.status === 'probation' ? 'active' : s.status === 'proposed' || s.retireProposed ? 'warn' : 'neutral'} />
                      </td>
                      <td className="px-3 py-2 text-right tabular text-muted">
                        {s.appliedIn.length}, {s.helped}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-2 text-[12px] text-faint border-t border-line">Helped means a task with the skill mounted was approved with no repeat of the finding it came from. Proposals also wait in the Factory queue.</p>
            </div>
            {selected ? (
              <ul>
                <SkillRow key={selected.id} s={selected} onChange={load} />
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
