import { useEffect, useState } from 'react';
import { DaemonError, type TaskBundle, api } from '../api';
import { Button, Kbd, StatusChip } from './ui';

/** Opens only on a green verification and a review that is not a block. The daemon enforces the same on /approve. */
export function gateState(b: TaskBundle): { open: boolean; reason: string } {
  if (b.task.status === 'done') return { open: false, reason: '' };
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
  // a approves, r asks for changes, x rejects: the keys the help lists, and the palette's request
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (bundle.task.status === 'done') return;
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
      setAsking(null);
      setText('');
      onDone();
    } catch (e) {
      setError(e instanceof DaemonError ? `${e.error.message}${e.error.hint ? `: ${typeof e.error.hint === 'string' ? e.error.hint : JSON.stringify(e.error.hint)}` : ''}` : String(e));
    }
  };
  return (
    <section data-testid="approval-gate" data-open={open} aria-label="Approval gate" className="border-t border-line bg-raised p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Approval</h2>
        <StatusChip label={bundle.task.status === 'done' ? 'merged' : open ? 'ready' : 'closed'} tone={bundle.task.status === 'done' ? 'good' : open ? 'warn' : 'neutral'} />
      </div>
      {reason ? <p className="text-[12px] text-muted">{reason}</p> : null}
      {bundle.task.status === 'done' ? (
        <div className="text-[12px]" data-testid="signoff">
          {bundle.merge ? (
            <>
              <p>
                Approved by {!bundle.merge.by || bundle.merge.by === 'human' ? 'you' : bundle.merge.by} and merged into {bundle.merge.into ?? 'the base branch'} as <span className="font-mono">{bundle.merge.commit.slice(0, 10)}</span>.
              </p>
              <p className="text-muted mt-1">
                The commit carries Stint-Task: {bundle.task.id}
                {bundle.merge.trailers['Stint-Verified'] ? `, Stint-Verified: ${bundle.merge.trailers['Stint-Verified']}` : ''}.
              </p>
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
          <label className="text-[12px] text-muted" htmlFor="gate-text">
            {asking === 'reject' ? 'Why reject it? The reason becomes a decision.' : 'What should change? This becomes the next ask.'}
          </label>
          <textarea id="gate-text" required value={text} onChange={(e) => setText(e.target.value)} rows={3} className="rounded-md border border-line bg-surface p-2 text-[13px]" />
          <div className="flex gap-2">
            <Button tone={asking === 'reject' ? 'danger' : 'primary'} type="submit">
              {asking === 'reject' ? 'Reject' : 'Request changes'}
            </Button>
            <Button onClick={() => setAsking(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" disabled={!open} data-testid="approve" onClick={() => void call(() => api.approve(id))}>
            Approve and merge <Kbd>a</Kbd>
          </Button>
          <Button onClick={() => setAsking('changes')}>
            Request changes <Kbd>r</Kbd>
          </Button>
          <Button tone="danger" onClick={() => setAsking('reject')}>
            Reject <Kbd>x</Kbd>
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-[12px] text-bad">
          {error}
        </p>
      ) : null}
    </section>
  );
}
