import { useEffect, useRef, useState } from 'react';
import { DaemonError, type TaskBundle, api } from '../api';
import { localDate, localTime } from '../format';
import { singleKey } from '../shortcuts';
import { Button, Kbd, StatusChip, Swatch, cx } from './ui';

const NOT_AT_THE_GATE: Record<string, string> = {
  planned: 'Nothing has been built yet.',
  building: 'A driver is out on this car. The flag waits for the next green verification.',
  verifying: 'The daemon is running the tests.',
  reviewing: 'The review is running.',
  rejected: 'Rejected. Send a driver out to try again.',
  approved: 'Approved; the merge is under way.',
  abandoned: 'This task was abandoned.',
};

/**
 * Opens only while the car waits at the gate, on a green verification and a review that is not a block. The daemon
 * enforces the same on /approve, and refuses while changes asked for are newer than the last green verification.
 */
export function gateState(b: TaskBundle): { open: boolean; reason: string } {
  if (b.task.status === 'done') return { open: false, reason: '' };
  if (b.task.status === 'in_review') return { open: false, reason: '' };
  if (b.task.status !== 'awaiting_approval') return { open: false, reason: NOT_AT_THE_GATE[b.task.status] ?? 'The car is not at the gate.' };
  if (!b.verification) return { open: false, reason: 'Waiting for the daemon to run the tests.' };
  if (b.verification.status !== 'green') return { open: false, reason: `The tests are red: ${b.verification.failed} failed.` };
  if (b.review?.verdict === 'block') return { open: false, reason: 'The review blocks this change.' };
  if (b.runs.some((r) => !r.endedAt)) return { open: false, reason: 'A run is still going.' };
  return { open: true, reason: `${b.verification.passed} passed, run by the daemon${b.review ? `; review: ${b.review.verdict.replace('_', ' ')}` : ''}.` };
}

export function ApprovalGate({ bundle, onDone }: { bundle: TaskBundle; onDone: () => void }) {
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
  const v = bundle.verification;
  const review = bundle.review;
  const done = bundle.task.status === 'done';
  const link = 'text-[12px] text-ink-2 underline-offset-2 hover:text-ink hover:underline';
  return (
    <section data-testid="approval-gate" data-open={open} aria-label="Approval gate" className="flex flex-col rounded-[4px] border border-rule-strong overflow-hidden">
      <div aria-hidden="true" className="chequer h-3.5" style={{ opacity: open || done ? 1 : 0.25 }} />
      <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[14px] leading-5 font-bold">The flag</h2>
          <StatusChip label={done ? 'merged' : open ? 'ready for you' : 'not yet'} tone={done ? 'merged' : open ? 'warn' : 'neutral'} />
        </div>
        {done ? null : (
          <ul className="flex flex-col gap-1 text-[14px] leading-5" aria-label="What the flag waits for">
            <li className="flex items-center gap-2">
              <Swatch tone={v ? (v.status === 'green' ? 'good' : 'bad') : 'neutral'} />
              {v ? `Verify ${v.status}, ${v.passed} passed${v.failed ? `, ${v.failed} failed` : ''}, run by the daemon` : 'Verify has not run on this code yet'}
            </li>
            <li className="flex items-center gap-2">
              <Swatch tone={review ? (review.verdict === 'approve' ? 'good' : review.verdict === 'block' ? 'bad' : 'warn') : 'neutral'} />
              {review ? `Review: ${review.verdict.replace('_', ' ')}${review.findings.length ? `, ${review.findings.length} finding${review.findings.length === 1 ? '' : 's'}` : ''}` : 'Review waits for a green verify'}
            </li>
          </ul>
        )}
        {reason && !open ? <p className="text-[12px] text-ink-2">{reason}</p> : null}
        {bundle.risk ? (
          <p className="text-[14px] flex flex-wrap items-baseline gap-2" data-testid="risk-line">
            <StatusChip label={`${bundle.risk.tier} risk`} tone={bundle.risk.tier === 'high' ? 'bad' : bundle.risk.tier === 'medium' ? 'warn' : 'neutral'} />
            <span className="text-ink-2">{bundle.risk.reasons.join('; ')}</span>
            {bundle.risk.byPolicy ? <span className="text-ink-2">Approved by the auto-approve lane, under the policy you turned on.</span> : null}
          </p>
        ) : null}
        {bundle.task.status === 'in_review' && bundle.release ? (
          <div className="text-[14px] flex flex-wrap items-center gap-2" data-testid="release">
            <p>
              In pull request review
              {bundle.release.url ? (
                <>
                  :{' '}
                  <a href={bundle.release.url} className="underline underline-offset-2" target="_blank" rel="noreferrer">
                    pull request {bundle.release.number ?? ''}
                  </a>
                </>
              ) : null}
              . The task finishes when it merges.
            </p>
            <Button onClick={() => void call(() => api.releaseRefresh(id))} data-testid="release-refresh">
              Check now
            </Button>
          </div>
        ) : null}
        {bundle.outcomes?.length ? (
          <div className="text-[14px]" data-testid="task-outcomes">
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
                      <a href={o.url} className="underline underline-offset-2" target="_blank" rel="noreferrer">
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
          <div className="text-[14px] leading-5" data-testid="signoff">
            {bundle.merge ? (
              <>
                <p>
                  Took the flag. Approved by <span data-testid="signoff-by">{!bundle.merge.by || bundle.merge.by === 'human' ? 'you' : bundle.merge.by}</span> and merged into {bundle.merge.into ?? 'the base branch'} as{' '}
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
                  <p className="mt-1 font-mono text-[12px] leading-4 text-ink-2 break-words">
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
              <p>Took the flag: merged into the base branch with the Stint-Task trailer.</p>
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
            <label className="text-[14px] font-bold" htmlFor="gate-text">
              {asking === 'reject' ? 'Why reject it? The reason becomes a decision.' : 'What should change? This becomes the next ask.'}
            </label>
            <textarea id="gate-text" required autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} className="rounded-[3px] border border-rule-strong bg-panel p-2 text-[14px] text-ink" />
            <div className="flex gap-2">
              <Button tone={asking === 'reject' ? 'danger' : 'primary'} type="submit">
                {asking === 'reject' ? 'Reject' : 'Request changes'}
              </Button>
              <Button onClick={close}>Cancel</Button>
            </div>
          </form>
        ) : (
          <>
            <Button tone="primary" disabled={!open} data-testid="approve" className="h-11 w-full justify-between px-4 text-[14px]" onClick={() => void call(() => api.approve(id))}>
              Approve and merge <Kbd>a</Kbd>
            </Button>
            <div className="flex flex-wrap gap-4">
              <button ref={askChanges} type="button" className={link} onClick={() => setAsking('changes')}>
                Request changes <Kbd>r</Kbd>
              </button>
              <button ref={askReject} type="button" className={cx(link, 'hover:text-red')} onClick={() => setAsking('reject')}>
                Reject <Kbd>x</Kbd>
              </button>
            </div>
          </>
        )}
        {error ? (
          <p role="alert" className="text-[14px] text-red">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
