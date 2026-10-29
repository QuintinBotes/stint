import type { StintEvent } from '@stint-dev/core';
import { useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { agentOf } from '../agents';
import { DaemonError, type GoalView, type PendingContradictionItem, type RunSummary, type TaskBundle, type TaskCardData, type Verification, api, readOnly } from '../api';
import { localDate, localTime } from '../format';
import { singleKey } from '../shortcuts';
import { HowItWent } from './HowItWent';
import { LookingBack, useHold } from './Scrubber';
import { Button, Explain, Kbd, type Shape, StateMark, StatusChip, Who, cx } from './ui';

const NOT_AT_THE_GATE: Record<string, string> = {
  planned: 'Nothing has been built yet.',
  building: 'A run is going on this task. The gate opens after the next green verification.',
  verifying: 'Stint is running the tests.',
  reviewing: 'The review is running.',
  rejected: 'Rejected. Hand the task to an agent to try again.',
  approved: 'Approved; the merge is under way.',
  abandoned: 'This task was abandoned.',
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Autopilot stopped at the gate, so sending the task back starts it again; the daemon's sendBack reads the log the same way (D-069). */
function rebuildsOnSendBack(events: StintEvent[]): boolean {
  const last = events.findLast((e) => e.type === 'autopilot.started' || e.type === 'autopilot.stopped');
  return last?.type === 'autopilot.stopped' && String(last.payload.reason ?? '').startsWith('Waiting for your approval.');
}

/** What made a verification red, in words: tampered tests, held-out scenarios that failed or could not run, the tests, or another check. */
export function redReason(v: Pick<Verification, 'passed' | 'failed' | 'reason' | 'checks' | 'tamper' | 'scenarios'>): string {
  if (v.reason === 'tampered') return `An agent changed the locked acceptance tests${v.tamper?.files.length ? ` (${v.tamper.files.join(', ')})` : ''}.`;
  if (v.reason === 'scenarios') return v.scenarios?.failed ? `${plural(v.scenarios.failed, 'held-out scenario')} failed.` : 'The held-out scenarios could not run, so they proved nothing.';
  const red = (v.checks ?? []).filter((c) => c.status === 'red');
  const tests = !v.checks || red.some((c) => c.kind === 'test');
  const parts = [
    ...(tests ? [v.failed ? `${v.failed} of ${plural(v.passed + v.failed, 'test')} failed` : 'the test command failed before any test was counted'] : []),
    ...red.filter((c) => c.kind !== 'test').map((c) => `the ${c.name} check failed`),
  ];
  const said = parts.join(', and ');
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
}

/**
 * Opens only while the task waits at the gate, on a green verification, a review that is not a block, and no review
 * finding waiting to reverse a decision. The daemon enforces the same on /approve, and refuses while changes asked for
 * are newer than the last green verification.
 */
export function gateState(b: TaskBundle, contradictions: PendingContradictionItem[] = [], events: StintEvent[] = []): { open: boolean; reason: string } {
  if (b.task.status === 'done') return { open: false, reason: '' };
  if (b.task.status === 'in_review') return { open: false, reason: '' };
  if (readOnly) return { open: false, reason: readOnly };
  // a building task whose runs have all ended is waiting, not working: autopilot stopped, or the next run is not started yet
  if (b.task.status === 'building' && b.runs.every((r) => r.endedAt)) return { open: false, reason: 'No run is going. The gate opens after the next green verification.' };
  // a review is said to run only while a reviewer's run is live
  if (b.task.status === 'reviewing' && !b.runs.some((r) => r.role === 'reviewer' && !r.endedAt)) return { open: false, reason: 'The tests passed, but no review is running.' };
  if (b.task.status !== 'awaiting_approval') return { open: false, reason: NOT_AT_THE_GATE[b.task.status] ?? 'The task is not at the gate.' };
  if (!b.verification) return { open: false, reason: 'Waiting for Stint to run the tests.' };
  if (b.verification.status !== 'green') return { open: false, reason: `Stint's check is red. ${redReason(b.verification)}` };
  if (b.review?.verdict === 'block') return { open: false, reason: 'The review blocks this change.' };
  const first = contradictions[0];
  if (first) {
    const d = first.decision?.id ?? 'a decision';
    return { open: false, reason: `${plural(contradictions.length, 'review finding')} would reverse a decision. Keep ${d} or supersede it, above the tabs, before you approve.` };
  }
  if (b.runs.some((r) => !r.endedAt)) return { open: false, reason: 'A run is still going.' };
  // at the gate with no review: the daemon said why on the approval request
  const unreviewed = b.review ? '' : String(events.findLast((e) => e.type === 'approval.requested')?.payload.reason ?? '');
  return { open: true, reason: `${plural(b.verification.passed, 'test')} passed, run by Stint${b.review ? `; review: ${b.review.verdict.replace('_', ' ')}` : ''}.${unreviewed ? ` ${unreviewed}` : ''}` };
}

/** The goal a merged task belongs to, read once, so the sign-off can offer the goal's next open task. */
function useGoalAfterMerge(goalId: string | undefined): GoalView | null {
  const [goal, setGoal] = useState<GoalView | null>(null);
  useEffect(() => {
    if (!goalId) return;
    let live = true;
    api
      .goal(goalId)
      .then((g) => live && setGoal(g))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [goalId]);
  return goalId ? goal : null;
}

const base = (path: string) => path.split('/').at(-1) ?? path;
/** The agent's one-word name, as the revision table writes it (Wonder, Muse, Claude, Glimmer); the cell's title has it in full. */
export const shortName = (name: string) => {
  const words = name.replace(/, local$/, '').split(' ');
  return (words[0] === 'Muse' && words[1] && words[1] !== 'Code' ? words[1] : words[0]) ?? name;
};

type Revision = { change: string; more: number; check: string; ink: string; shape?: Shape };

/** One revision: what a run changed (its first file and how many more) and what the daemon's check said, in words, with the state's ink and shape. */
function revision(r: RunSummary, events: StintEvent[], b: TaskBundle): Revision {
  const mine = events.filter((e) => e.run === r.run);
  const files = [...new Set(mine.filter((e) => e.type === 'file.changed' && typeof e.payload.path === 'string').map((e) => e.payload.path as string))];
  const change = r.role === 'planner' ? 'Plan' : r.role === 'reviewer' ? 'Review' : files.length === 0 ? 'No files' : base(files[0] as string);
  const it = { change, more: r.role === 'implementer' ? Math.max(0, files.length - 1) : 0 };
  if (!r.endedAt) return { ...it, check: 'Running', ink: 'text-ink-2', shape: 'running' };
  if (r.endedBy === 'killed' || r.endedBy === 'failed') return { ...it, check: r.endedBy === 'killed' ? 'Killed' : 'Failed', ink: 'text-red', shape: 'failed' };
  if (r.role === 'planner') return { ...it, check: 'None', ink: 'text-ink-3' };
  if (r.role === 'reviewer') {
    const rev = mine.find((e) => e.type === 'review.recorded');
    const verdict = String(rev?.payload.verdict ?? '').replace('_', ' ');
    if (!verdict) return { ...it, check: 'Not recorded', ink: 'text-ink-3' };
    // a verdict is not a verification, so it is never green and never ticked
    return { ...it, check: `${verdict.charAt(0).toUpperCase()}${verdict.slice(1)}`, ...(verdict === 'block' ? { ink: 'text-red', shape: 'failed' as const } : { ink: 'text-ink' }) };
  }
  const v = mine.filter((e) => e.type === 'verification.ran').at(-1);
  if (!v) return { ...it, check: 'Not run', ink: 'text-ink-3' };
  return v.payload.status === 'green' ? { ...it, check: `${Number(v.payload.passed)} passed`, ink: 'text-green', shape: 'verified' } : { ...it, check: `${Number(v.payload.failed)} failed`, ink: 'text-red', shape: 'failed' };
}

/** How many revisions the block lists; the rail above holds them all. */
const SHOWN = 6;

/**
 * The revision block: the run history set as a drawing's revision table (run, change, by, the daemon's check), closed by
 * the approval row with Approve and merge as its last cell. Rewound (`seen` is the events by then), the rows show the task
 * as it was and every action holds until Return to latest, keys and the palette's requests included: the gate acts only on
 * the task as it is now.
 * Above the buttons, the evidence for the decision: the change's size, how much of it you have viewed, and the review.
 */
export function ApprovalGate({ bundle, events, seen, files, viewed, tasks, contradictions = [], onDone }: { bundle: TaskBundle; events: StintEvent[]; seen: StintEvent[] | null; files: Array<{ path: string; added: number; removed: number }>; viewed: Set<string>; tasks: TaskCardData[] | null; contradictions?: PendingContradictionItem[]; onDone: () => void }) {
  const gate = gateState(bundle, contradictions, events);
  const back = useContext(LookingBack);
  const hold = useHold();
  // a rewound view shows the past; approving from it would act on a task the page is not showing
  const open = gate.open && !seen;
  const reason = gate.open && seen ? 'Return to latest to approve.' : gate.reason;
  const [error, setError] = useState<string | null>(null);
  // the action whose request is out, so its button says so and a second press sends nothing
  const [busy, setBusy] = useState<'approve' | 'send' | 'refresh' | null>(null);
  const pending = useRef(false);
  // the first a gets Approve ready and says what it will do; a second a, or Enter, merges. A click is one step.
  const [armed, setArmed] = useState(false);
  const approveButton = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState<'changes' | 'reject' | null>(null);
  const [text, setText] = useState('');
  const id = bundle.task.id;
  const askChanges = useRef<HTMLButtonElement>(null);
  const askReject = useRef<HTMLButtonElement>(null);
  // closing the form drops what was typed and puts focus back on the button that opened it
  const close = () => {
    const opener = asking === 'reject' ? askReject : askChanges;
    setAsking(null);
    setText('');
    requestAnimationFrame(() => opener.current?.focus());
  };
  // a approves, r asks for changes, x rejects: the keys the help lists, and the palette's request. While the form is
  // open no key acts but Escape, which closes it.
  // nothing built yet: there is no change to send back or reject
  const built = bundle.runs.some((r) => r.role === 'implementer' && r.endedAt);
  const rebuilds = rebuildsOnSendBack(events);
  useEffect(() => {
    if (back) setArmed(false);
  }, [back]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (asking) {
        if (e.key === 'Escape') close();
        return;
      }
      if (back || !singleKey(e) || bundle.task.status === 'done') return;
      if (e.key === 'a' && open) {
        if (armed) void approve();
        else arm();
      } else if (e.key === 'Escape' && armed) setArmed(false);
      else if ((e.key === 'r' || e.key === 'x') && built) {
        // the field the key opens takes focus before the key's letter lands, so the letter must not land
        e.preventDefault();
        setAsking(e.key === 'r' ? 'changes' : 'reject');
      }
    };
    const onAsk = (e: Event) => {
      if (back) return;
      const want = (e as CustomEvent<'changes' | 'reject' | 'approve'>).detail;
      if (want === 'approve') {
        if (open) arm();
      } else if (built) setAsking(want);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('stint:gate', onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('stint:gate', onAsk);
    };
  });
  const call = async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>): Promise<boolean> => {
    if (pending.current || back) return false;
    pending.current = true;
    setBusy(kind);
    setError(null);
    try {
      await fn();
      if (asking) close();
      setText('');
      onDone();
      return true;
    } catch (e) {
      // what was typed stays in the form; the daemon's words go beside the actions
      setError(e instanceof DaemonError ? `${e.error.message}${e.error.hint ? `: ${typeof e.error.hint === 'string' ? e.error.hint : JSON.stringify(e.error.hint)}` : ''}` : String(e));
      return false;
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };
  const arm = () => {
    setArmed(true);
    requestAnimationFrame(() => approveButton.current?.focus());
  };
  const approve = async () => {
    setArmed(false);
    if (await call('approve', () => api.approve(id))) toast.success(`${id} merged.`);
  };
  const done = bundle.task.status === 'done';
  const started = seen ? new Set(seen.filter((e) => e.type === 'run.started').map((e) => e.run)) : null;
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const seenFiles = files.filter((f) => viewed.has(f.path)).length;
  const goalId = bundle.task.goalId;
  const goal = useGoalAfterMerge(done ? goalId : undefined);
  // after a merge, the goal's next open task in its order comes first, else whichever task waits for approval
  const goalNext = goal?.tasks.find((x) => x.id !== id && !['done', 'approved', 'abandoned'].includes(x.status));
  const waiting = done ? (tasks ?? []).map((x) => x.task).find((x) => x.status === 'awaiting_approval' && x.id !== id) : undefined;
  const runs = bundle.runs.slice(-SHOWN);
  const earlier = bundle.runs.length - runs.length;
  const cell = 'px-1.5 py-[5px] border border-rule-strong text-left align-top';
  const small = 'h-8 px-2.5 text-small';
  return (
    <section data-testid="approval-gate" data-open={open} aria-label="Approval gate" className="outline outline-ink-3">
      <table className="w-full table-fixed border-collapse text-small">
        <caption className="caption-top px-2.5 py-2 text-left font-semibold border border-b-0 border-rule-strong bg-panel">Revisions of {id}</caption>
        {/* fixed columns, so the block keeps to the rail's width; a long file name wraps in its own cell */}
        <colgroup>
          <col className="w-9" />
          <col />
          <col className="w-[84px]" />
          <col className="w-[92px]" />
        </colgroup>
        <thead>
          <tr className="bg-panel text-ink-2">
            {['Run', 'Change', 'By', 'Result'].map((h) => (
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
                Each run appears here with what it changed and what Stint's check said.
              </td>
            </tr>
          ) : null}
          {runs.map((r) => {
            const rev = revision(r, seen ?? events, bundle);
            const agent = agentOf(r.adapter, r.host, r.model);
            const later = started !== null && !started.has(r.run);
            return (
              // a run not started at the moment the clock is on goes quiet, in ink-3 so it stays legible, and has no check yet
              <tr key={r.run} data-testid="revision" data-run={r.run} data-later={later} className={cx('bg-ground transition-colors duration-[220ms] ease-out motion-reduce:transition-none', later && 'text-ink-3')}>
                <td className={cx(cell, 'font-mono whitespace-nowrap')}>{r.run}</td>
                {/* one line per run: a long file name ends in an ellipsis, with the whole name in its title */}
                <td className={cell} title={rev.more ? `${rev.change} and ${rev.more} more` : rev.change}>
                  <span className="flex min-w-0">
                    <span className="truncate">{rev.change}</span>
                    {rev.more ? <span className="shrink-0 tabular">&nbsp;+{rev.more}</span> : null}
                  </span>
                </td>
                <td className={cx(cell, 'whitespace-nowrap overflow-hidden')} title={agent.name}>
                  <Who agent={{ ...agent, name: shortName(agent.name) }} className={cx('max-w-full', later ? 'font-medium' : 'font-semibold')} />
                </td>
                <td className={cx(cell, 'whitespace-nowrap', later ? 'text-ink-3' : rev.ink)}>
                  {later ? (
                    'Not yet'
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      {rev.shape ? <StateMark shape={rev.shape} /> : null}
                      {rev.check}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="p-2.5 border border-rule-strong bg-panel">
              <div className="flex flex-col gap-2.5">
                {seen ? (
                  <p className="text-ink-2" data-testid="gate-rewound">
                    You are looking at an earlier moment; this approval is the task as it is now.
                  </p>
                ) : null}
                {!done && (reason || files.length > 0) ? (
                  <p className="text-ink-2" data-testid="gate-evidence">
                    {reason ? <span className={open ? 'text-ink' : undefined}>{reason} </span> : null}
                    {files.length > 0 ? (
                      <>
                        {files.length} file{files.length === 1 ? '' : 's'} changed, +{added} -{removed}.{' '}
                        <span className={cx(seenFiles < files.length && open && 'text-amber')} data-testid="gate-viewed">
                          You have viewed {seenFiles} of {files.length}.
                        </span>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {contradictions.length && !done ? (
                  <ul className="flex flex-col gap-1.5" data-testid="gate-contradictions" aria-label="Decisions waiting">
                    {contradictions.map((c) => (
                      <li key={c.id} className="flex items-start gap-1.5">
                        <StateMark shape="attention" className="mt-1 text-amber" />
                        <span>
                          <span className="font-mono">{c.finding.id}</span> would reverse <span className="font-mono">{c.decision?.id ?? 'a decision'}</span>
                          {c.decision ? `, "${c.decision.text}"` : ''}: {c.finding.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
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
                    <Button className={small} disabled={busy !== null} aria-busy={busy === 'refresh'} onClick={() => void call('refresh', () => api.releaseRefresh(id))} data-testid="release-refresh" {...hold}>
                      {busy === 'refresh' ? 'Checking' : 'Check now'}
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
                        {goalId ? (
                          <p className="mt-2" data-testid="signoff-goal">
                            Part of{' '}
                            <Link to={`/goals/${goalId}`} className="font-mono underline decoration-rule-strong hover:decoration-ink">
                              {goalId}
                            </Link>
                            : see how the goal stands.
                          </p>
                        ) : null}
                        {goalNext ? (
                          <p className="mt-2">
                            Next in {goalId}:{' '}
                            <Link to={`/t/${goalNext.id}`} className="font-medium underline decoration-rule-strong hover:decoration-ink" data-testid="next-task">
                              {goalNext.id} {goalNext.title}
                            </Link>
                          </p>
                        ) : waiting ? (
                          <p className="mt-2">
                            Next:{' '}
                            <Link to={`/t/${waiting.id}`} className="font-medium underline decoration-rule-strong hover:decoration-ink" data-testid="next-task">
                              {waiting.id} needs you
                            </Link>
                          </p>
                        ) : null}
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
                      void call('send', () => (asking === 'reject' ? api.reject(id, text) : api.requestChanges(id, text)));
                    }}
                  >
                    <label className="font-semibold" htmlFor="gate-text">
                      {asking === 'reject'
                        ? `Why reject it? The reason becomes a decision${rebuilds ? ', and autopilot builds the task again from it.' : ', and the task goes to Needs you as rejected.'}`
                        : `What should change? ${rebuilds ? 'Autopilot builds the task again with this as the ask.' : 'This becomes the next ask, and the task goes to Needs you as rejected until an agent takes it.'}`}
                    </label>
                    <textarea id="gate-text" required autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} className="stint-input min-h-0 px-2.5 py-2" />
                    <div className="grid grid-cols-2 gap-2">
                      <Button tone={asking === 'reject' ? 'danger' : 'primary'} type="submit" className={small} disabled={busy !== null} aria-busy={busy === 'send'} {...hold}>
                        {busy === 'send' ? 'Sending' : asking === 'reject' ? 'Reject' : 'Request changes'}
                      </Button>
                      <Button className={small} onClick={close}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    {/* nothing to tell before a run, and no decorative $0.00 */}
                    {bundle.task.status === 'rejected' || bundle.task.status === 'abandoned' || bundle.runs.length === 0 ? null : <HowItWent bundle={bundle} />}
                    <Button
                      ref={approveButton}
                      tone="primary"
                      // shut at a closed gate; looking back at an open one it holds, focusable, with the notice as its reason
                      disabled={!gate.open || busy !== null}
                      aria-busy={busy === 'approve'}
                      data-testid="approve"
                      data-armed={armed}
                      aria-keyshortcuts="a"
                      aria-describedby={armed ? 'approve-armed' : undefined}
                      className="w-full"
                      onBlur={() => setArmed(false)}
                      onClick={() => void approve()}
                      {...hold}
                    >
                      {busy === 'approve' ? 'Merging' : 'Approve and merge'} <Kbd>a</Kbd>
                    </Button>
                    {armed ? (
                      <p id="approve-armed" role="status" className="text-ink" data-testid="approve-armed">
                        Press a again, or Enter, to merge {bundle.task.branch}. Escape cancels.
                      </p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2">
                      <Button ref={askChanges} className={small} aria-keyshortcuts="r" disabled={!built || busy !== null} onClick={() => setAsking('changes')} data-testid="ask-changes" {...hold}>
                        Request changes
                      </Button>
                      <Button ref={askReject} className={small} aria-keyshortcuts="x" disabled={!built || busy !== null} onClick={() => setAsking('reject')} data-testid="ask-reject" {...hold}>
                        Reject
                      </Button>
                    </div>
                    <Explain word="gate" />
                  </>
                )}
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
