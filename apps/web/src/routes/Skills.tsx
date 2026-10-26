import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type SkillRecord, api } from '../api';
import { Button, EmptyState, StatusChip } from '../components/ui';

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
          <StatusChip label={s.status} tone={s.status === 'active' ? 'good' : s.status === 'proposed' ? 'warn' : 'neutral'} />
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
        <dd className="tabular">
          {s.appliedIn.length ? `applied in ${s.appliedIn.length} run${s.appliedIn.length === 1 ? '' : 's'}, approved without rejection after it ${s.helped} time${s.helped === 1 ? '' : 's'}` : 'not applied yet'}
        </dd>
      </dl>
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
  const load = useCallback(() => {
    api
      .skills()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);
  useEffect(load, [load]);
  const order = (s: SkillRecord) => (s.status === 'proposed' ? 0 : s.status === 'active' ? 1 : 2);
  return (
    <main className="flex-1 min-h-0 overflow-y-auto" data-testid="skills">
      <div className="max-w-[900px] mx-auto px-4 py-6">
        <h1 className="text-[20px] font-semibold">Skills</h1>
        <p className="text-muted text-[13px] mt-1 mb-4 max-w-[72ch]">
          Rules the agents load before a run. When a review finding recurs across tasks, the learn step proposes one with its evidence; nothing is written to <span className="font-mono">.agents/skills</span> until you approve it.
        </p>
        {skills === null ? <p className="text-faint">Reading the skills.</p> : null}
        {skills?.length === 0 ? <EmptyState>No skills yet. A skill appears here when a review finding recurs across two tasks, or when a file is added to .agents/skills.</EmptyState> : null}
        <ul className="flex flex-col gap-3">
          {[...(skills ?? [])].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id)).map((s) => (
            <SkillRow key={s.id} s={s} onChange={load} />
          ))}
        </ul>
      </div>
    </main>
  );
}
