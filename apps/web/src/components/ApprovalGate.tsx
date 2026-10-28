import type { StintEvent } from '@stint-dev/core';
import { useEffect, useRef, useState } from 'react';
import { agentOf } from '../agents';
import { DaemonError, type RunSummary, type TaskBundle, api } from '../api';
import { localDate, localTime } from '../format';
import { singleKey } from '../shortcuts';
import { Button, Kbd, StatusChip, Who, cx } from './ui';

const NOT_AT_THE_GATE: Record<string, string> = {
  planned: 'Nothing has been built yet.',
  building: 'A run is going on this task. The gate opens after the next green verification.',
  verifying: 'The daemon is running the tests.',
  reviewing: 'The review is running.',
  rejected: 'Rejected. Hand the task to an agent to try again.',
  approved: 'Approved; the merge is under way.',
  abandoned: 'This task was abandoned.',
};

/**
 * Opens only while the task waits at the gate, on a green verification and a review that is not a block. The daemon
 * enforces the same on /approve, and refuses while changes asked for are newer than the last green verification.
 */
export function gateState(b: TaskBundle): { open: boolean; reason: string } {
  if (b.task.status === 'done') return { open: false, reason: '' };
  if (b.task.status === 'in_review') return { open: false, reason: '' };
  if (b.task.status !== 'awaiting_approval') return { open: false, reason: NOT_AT_THE_GATE[b.task.status] ?? 'The task is not at the gate.' };
  if (!b.verification) return { open: false, reason: 'Waiting for the daemon to run the tests.' };
  if (b.verification.status !== 'green') return { open: false, reason: `The tests are red: ${b.verification.failed} failed.` };
  if (b.review?.verdict === 'block') return { open: false, reason: 'The review blocks this change.' };
  if (b.runs.some((r) => !r.endedAt)) return { open: false, reason: 'A run is still going.' };
  return { open: true, reason: `${b.verification.passed} passed, run by the daemon${b.review ? `; review: ${b.review.verdict.replace('_', ' ')}` : ''}.` };
}

const base = (path: string) => path.split('/').at(-1) ?? path;
/** The agent's one-word name, as the revision table writes it (Wonder, Muse, Claude, Glimmer); the cell's title has it in full. */
export const shortName = (name: string) => {
  const words = name.replace(/, local$/, '').split(' ');
  return (words[0] === 'Muse' && words[1] && words[1] !== 'Code' ? words[1] : words[0]) ?? name;
};

/** One revision: what a run changed and what the daemon's check said, in words, with the state's ink. */
function revision(r: RunSummary, events: StintEvent[], b: TaskBundle): { change: string; check: string; ink: string } {
  const mine = events.filter((e) => e.run === r.run);
  const files = [...new Set(mine.filter((e) => e.type === 'file.changed' && typeof e.payload.path === 'string').map((e) => e.payload.path as string))];
  const change = r.role === 'planner' ? 'Plan' : r.role === 'reviewer' ? 'Review' : files.length === 0 ? 'No files' : `${base(files[0] as string)}${files.length > 1 ? ` +${files.length - 1}` : ''}`;
  if (!r.endedAt) return { change, check: 'Running', ink: 'text-ink-2' };
  if (r.endedBy === 'killed' || r.endedBy === 'failed') return { change, check: r.endedBy === 'killed' ? 'Killed' : 'Failed', ink: 'text-red' };
  if (r.role === 'planner') return { change, check: 'None', ink: 'text-ink-3' };
  if (r.role === 'reviewer') {
    const rev = mine.find((e) => e.type === 'review.recorded');
    const verdict = String(rev?.payload.verdict ?? '').replace('_', ' ');
    if (!verdict) return { change, check: 'Not recorded', ink: 'text-ink-3' };
    // a verdict is not a verification, so it is never green
    return { change, check: `${verdict.charAt(0).toUpperCase()}${verdict.slice(1)}`, ink: verdict === 'block' ? 'text-red' : 'text-ink' };
  }
  const v = mine.filter((e) => e.type === 'verification.ran').at(-1);
  if (!v) return { change, check: 'Not run', ink: 'text-ink-3' };
  return v.payload.status === 'green' ? { change, check: `${Number(v.payload.passed)} passed`, ink: 'text-green' } : { change, check: `${Number(v.payload.failed)} failed`, ink: 'text-red' };
}

/** How many revisions the block lists; the rail above holds them all. */
const SHOWN = 6;

/**
 * The revision block: the run history set as a drawing's revision table (run, change, by, the daemon's check), closed by
 * the approval row with Approve and merge as its last cell. Rewound (`seen` is the events by then), the runs not started
 * yet go quiet; the gate itself always acts on the task as it is now.
 */
export function ApprovalGate({ bundle, events, seen, onDone }: { bundle: TaskBundle; events: StintEvent[]; seen: StintEvent[] | null; onDone: () => void }) {
  const { open, reason } = gateState(bundle);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<'changes' | 'reject' | null>(null);
  const [text, setText] = useState('');
  const id = bundle.task.id;
  const askChanges = useRef<HTMLButtonElement>(null);
  const askReject = useRef<HTMLButtonElement>(null);
  // closing the form puts focus back on the button that opened it
  const close = () => {
    const opener = asking === 'reject' ? askReject : askChanges;
    setAsking(null);
    requestAnimationFrame(() => opener.current?.focus());
  };
  // a approves, r asks for changes, x rejects: the keys the help lists, and the palette's request. While the form is
  // open no key acts but Escape, which closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (asking) {
        if (e.key === 'Escape') close();
        return;
      }
      if (!singleKey(e) || bundle.task.status === 'done') return;
      if (e.key === 'a' && open) void call(() => api.approve(id));
      else if (e.key === 'r') setAsking('changes');
      else if (e.key === 'x') setAsking('reject');
    };
    const onAsk = (e: Event) => setAsking((e as CustomEvent<'changes' | 'reject'>).detail);
    window.addEventListener('keydown', onKey);
    window.addEventListener('stint:gate', onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('stint:gate', onAsk);
    };
  });
  const call = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      if (asking) close();
      setText('');
      onDone();
    } catch (e) {
      setError(e instanceof DaemonError ? `${e.error.message}${e.error.hint ? `: ${typeof e.error.hint === 'string' ? e.error.hint : JSON.stringify(e.error.hint)}` : ''}` : String(e));
    }
  };
  const done = bundle.task.status === 'done';
  const started = seen ? new Set(seen.filter((e) => e.type === 'run.started').map((e) => e.run)) : null;
  const runs = bundle.runs.slice(-SHOWN);
  const earlier = bundle.runs.length - runs.length;
  const cell = 'px-[7px] py-[5px] border border-rule-strong text-left align-top';
  const small = 'h-8 px-2.5 text-small';
  return (
    <section data-testid="approval-gate" data-open={open} aria-label="Approval gate" className="outline outline-ink-3">
      <table className="w-full table-fixed border-collapse text-small">
        <caption className="caption-top px-2.5 py-2 text-left font-semibold border border-b-0 border-rule-strong bg-panel">Revisions of {id}</caption>
        {/* fixed columns, so the block keeps to the rail's width; a long file name wraps in its own cell */}
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-[82px]" />
          <col className="w-[78px]" />
        </colgroup>
        <thead>
          <tr className="bg-panel text-ink-2">
            {['Run', 'Change', 'By', 'Check'].map((h) => (
              <th key={h} scope="col" className={cx(cell, 'font-medium')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {earlier > 0 ? (
            <tr className="bg-ground">
              <td colSpan={4} className={cx(cell, 'text-ink-2')}>
                {earlier} earlier run{earlier === 1 ? '' : 's'}, on the rail above
              </td>
            </tr>
          ) : null}
          {runs.length === 0 ? (
            <tr className="bg-ground">
              <td colSpan={4} className={cx(cell, 'text-ink-2')}>
                Each run appears here with what it changed and what the daemon's check said.
              </td>
            </tr>
          ) : null}
          {runs.map((r) => {
            const rev = revision(r, events, bundle);
            const agent = agentOf(r.adapter, r.host, r.model);
            const later = started !== null && !started.has(r.run);
            return (
              // a run not started at the moment the clock is on goes quiet, in ink-3 so it stays legible, and has no check yet
              <tr key={r.run} data-testid="revision" data-run={r.run} data-later={later} className={cx('bg-ground transition-colors duration-[220ms] ease-out motion-reduce:transition-none', later && 'text-ink-3')}>
                <td className={cx(cell, 'font-mono whitespace-nowrap')}>{r.run}</td>
                <td className={cx(cell, '[overflow-wrap:anywhere]')}>{rev.change}</td>
                <td className={cx(cell, 'whitespace-nowrap overflow-hidden')} title={agent.name}>
                  <Who agent={{ ...agent, name: shortName(agent.name) }} className={cx('max-w-full', later ? 'font-medium' : 'font-semibold')} />
                </td>
                <td className={cx(cell, later ? 'text-ink-3' : rev.ink)}>{later ? 'Not yet' : rev.check}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="p-2.5 border border-rule-strong bg-panel">
              <div className="flex flex-col gap-2.5">
                {done ? null : (
                  <div className="flex items-baseline justify-between gap-2">
                    <b className="font-semibold">Approved by</b>
                    <span className={cx(!open && 'text-ink-3')}>{open ? 'You, pending' : 'Not yet'}</span>
                  </div>
                )}
                {seen ? <p className="text-ink-2">The gate acts on the task as it is now.</p> : null}
                {bundle.risk ? (
                  <p className="flex flex-wrap items-baseline gap-2" data-testid="risk-line">
                    <StatusChip label={`${bundle.risk.tier} risk`} tone={bundle.risk.tier === 'high' ? 'bad' : bundle.risk.tier === 'medium' ? 'warn' : 'neutral'} />
                    <span className="text-ink-2">{bundle.risk.reasons.join('; ')}</span>
                    {bundle.risk.byPolicy ? <span className="text-ink-2">Approved by the auto-approve lane, under the policy you turned on.</span> : null}
                  </p>
                ) : null}
                {bundle.task.status === 'in_review' && bundle.release ? (
                  <div className="flex flex-wrap items-center gap-2" data-testid="release">
                    <p>
                      In pull request review
                      {bundle.release.url ? (
                        <>
                          :{' '}
                          <a href={bundle.release.url} className="underline" target="_blank" rel="noreferrer">
                            pull request {bundle.release.number ?? ''}
                          </a>
                        </>
                      ) : null}
                      . The task finishes when it merges.
                    </p>
                    <Button className={small} onClick={() => void call(() => api.releaseRefresh(id))} data-testid="release-refresh">
                      Check now
                    </Button>
                  </div>
                ) : null}
                {bundle.outcomes?.length ? (
                  <div data-testid="task-outcomes">
                    <p className="text-ink-2 mb-1">After merge:</p>
                    <ul className="flex flex-col gap-1">
                      {bundle.outcomes.map((o, i) => (
                        <li key={`${o.type}-${i}`}>
                          {o.kind === 'reverted'
                            ? `Reverted${o.by ? ` by ${o.by}` : ''}${o.commit ? ` in ${o.commit.slice(0, 10)}` : ''}.`
                            : o.kind === 'followup'
                              ? `Followed up by ${o.followup ?? 'a later task'}${o.files.length ? ` on ${o.files.join(', ')}` : ''}.`
                              : o.kind === 'ci'
                                ? `CI failed on the merged commit (run ${o.run ?? 'unknown'}).`
                                : `Incident: ${o.summary ?? 'reported against the merged commit'}.`}
                          {o.url ? (
                            <>
                              {' '}
                              <a href={o.url} className="underline" target="_blank" rel="noreferrer">
                                Details
                              </a>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {done ? (
                  <div data-testid="signoff">
                    {bundle.merge ? (
                      <>
                        <p>
                          Approved by <span data-testid="signoff-by">{!bundle.merge.by || bundle.merge.by === 'human' ? 'you' : bundle.merge.by}</span> and merged into {bundle.merge.into ?? 'the base branch'} as{' '}
                          <span className="font-mono" data-testid="signoff-commit">
                            {bundle.merge.commit.slice(0, 10)}
                          </span>
                          .
                        </p>
                        <p className="text-ink-2 mt-1">
                          <span data-testid="signoff-at">
                            {localDate(bundle.merge.at)}, {localTime(bundle.merge.at)}
                          </span>
                          {bundle.merge.verificationHash ? (
                            <>
                              . Verification{' '}
                              <span className="font-mono" data-testid="signoff-hash" title={bundle.merge.verificationHash}>
                                {bundle.merge.verificationHash.slice(0, 12)}
                              </span>
                            </>
                          ) : null}
                          .
                        </p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-ink-2 hover:text-ink">Merge details</summary>
                          <p className="mt-1 font-mono text-ink-2 break-words">
                            {Object.entries(bundle.merge.trailers).length
                              ? Object.entries(bundle.merge.trailers).map(([k, val]) => (
                                  <span key={k} className="block">
                                    {k}: {val}
                                  </span>
                                ))
                              : `Stint-Task: ${bundle.task.id}`}
                          </p>
                        </details>
                      </>
                    ) : (
                      <p>Merged into the base branch with the Stint-Task trailer.</p>
                    )}
                  </div>
                ) : asking ? (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void call(() => (asking === 'reject' ? api.reject(id, text) : api.requestChanges(id, text)));
                    }}
                  >
                    <label className="font-semibold" htmlFor="gate-text">
                      {asking === 'reject' ? 'Why reject it? The reason becomes a decision.' : 'What should change? This becomes the next ask.'}
                    </label>
                    <textarea id="gate-text" required autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-[5px] border border-field bg-ground px-2.5 py-2 text-body text-ink resize-y" />
                    <div className="grid grid-cols-2 gap-2">
                      <Button tone={asking === 'reject' ? 'danger' : 'primary'} type="submit" className={small}>
                        {asking === 'reject' ? 'Reject' : 'Request changes'}
                      </Button>
                      <Button className={small} onClick={close}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <Button tone="primary" disabled={!open} data-testid="approve" className="w-full" onClick={() => void call(() => api.approve(id))}>
                      Approve and merge <Kbd>a</Kbd>
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button ref={askChanges} className={small} title="Shortcut: r" onClick={() => setAsking('changes')}>
                        Request changes
                      </Button>
                      <Button ref={askReject} className={small} title="Shortcut: x" onClick={() => setAsking('reject')}>
                        Reject
                      </Button>
                    </div>
                  </>
                )}
                {reason && !done ? <p className="text-ink-2">{reason}</p> : null}
                {error ? (
                  <p role="alert" className="text-red">
                    {error}
                  </p>
                ) : null}
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
