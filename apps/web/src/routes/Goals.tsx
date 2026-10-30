import { CRITERION_STATE_LABELS, type GoalOutcome, type OutcomeResult, type ProposedTask } from '@stint-dev/core';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { type GoalView, api, daemonMessage, readOnly } from '../api';
import { CRITERION } from '../components/HowItWent';
import { Meter } from '../components/Limits';
import { Sharpen } from '../components/SharpenPanel';
import { Button, type ChipTone, EmptyState, Explain, type Shape, StatusChip, cx } from '../components/ui';
import { money, moneyOf } from '../format';
import { useGoal, useGoals } from '../hooks';

// a merge that held up stays neutral like every closed outcome; one that went wrong after is a failure
const RESULT: Record<OutcomeResult, { tone: ChipTone; shape: Shape }> = {
  in_progress: { tone: 'neutral', shape: 'waiting' },
  waiting_for_you: { tone: 'warn', shape: 'attention' },
  stopped_at_limit: { tone: 'warn', shape: 'attention' },
  stopped_needs_you: { tone: 'warn', shape: 'attention' },
  rejected: { tone: 'bad', shape: 'failed' },
  abandoned: { tone: 'neutral', shape: 'abandoned' },
  merged: { tone: 'merged', shape: 'closed' },
  merged_reverted: { tone: 'bad', shape: 'failed' },
  merged_followup: { tone: 'merged', shape: 'closed' },
  merged_ci_failed: { tone: 'bad', shape: 'failed' },
  merged_incident: { tone: 'bad', shape: 'failed' },
  merged_held_up: { tone: 'merged', shape: 'closed' },
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const met = (o: GoalOutcome) => `${o.met} of ${plural(o.criteria.length, 'criterion', 'criteria')} met`;
const spend = (o: GoalOutcome) => moneyOf(o.spend.usd, o.spend.limit);
const LINK = 'underline decoration-rule-strong underline-offset-4 hover:decoration-ink';

function Page({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <main className="relative flex-1 min-h-0 overflow-y-auto" data-testid={testId}>
      <div className="stint-page">{children}</div>
    </main>
  );
}

/** A goal's status. A goal with tasks is "running" in the daemon's words even while none of them executes, so it reads "in progress" with a ring here, as the Board keeps "running" for work that executes now. */
function GoalStatus({ status }: { status: string }) {
  return status === 'running' ? <StatusChip status={status} label="in progress" tone="neutral" shape="waiting" /> : <StatusChip status={status} />;
}

/** A wide table scrolls sideways in its own frame on a phone, so the page never does. */
function Scroller({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stint-table-region" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** A read that failed, in the daemon's words, with a retry: in place of the page when nothing was read yet, above the last read when a refresh failed. */
function LoadNotice({ what, error, stale, onRetry, testId }: { what: string; error: string; stale: boolean; onRetry: () => void; testId: string }) {
  return (
    <div role="alert" className={cx('stint-notice', stale ? 'stint-notice--attention' : 'stint-notice--error')} data-testid={testId}>
      <p className="min-w-0">{stale ? `Showing ${what} as last read. The refresh failed: ${error}.` : `${what.charAt(0).toUpperCase()}${what.slice(1)} did not load: ${error}.`}</p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}

/** Goals (R-064): the list at /goals, one goal at /goals/:id. */
export function Goals({ onNewGoal, replay = false }: { onNewGoal: () => void; replay?: boolean }) {
  const { id } = useParams();
  return id ? <GoalPage id={id} replay={replay} /> : <GoalList onNewGoal={onNewGoal} />;
}

function GoalList({ onNewGoal }: { onNewGoal: () => void }) {
  const { data: goals, error, reload } = useGoals();
  return (
    <Page testId="goals">
      <header className="stint-page-header">
        <div className="stint-page-heading">
          <h1 className="stint-page-title">Goals</h1>
          <p className="stint-page-summary">Each goal is an outcome bigger than one task. Stint splits it into tasks, and each criterion shows how the tasks covering it went.</p>
          <Explain word="goal" className="mt-2" />
        </div>
        <div className="stint-actions">
          <Button tone="primary" onClick={onNewGoal} data-testid="new-goal">
            New goal
          </Button>
        </div>
      </header>
      {error ? <LoadNotice what="the goals" error={error} stale={goals !== null} onRetry={reload} testId={goals ? 'goals-stale' : 'goals-error'} /> : null}
      {goals === null && !error ? <p className="text-ink-3">Reading the goals.</p> : null}
      {goals?.length === 0 ? <EmptyState testId="goals-empty">No goals yet: make one, and the tasks Stint splits it into appear under it.</EmptyState> : null}
      {goals?.length ? (
        <Scroller label="Goals">
          <table className="stint-table min-w-[640px]" data-testid="goal-list">
            <thead>
              <tr>
                {['Goal', 'Status', 'Criteria', 'Tasks'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {goals.map(({ goal, outcome: o }) => (
                <tr key={goal.id} data-testid={`goal-row-${goal.id}`}>
                  <th scope="row" className="font-normal">
                    <Link to={`/goals/${goal.id}`} className={cx(LINK, 'text-ink')}>
                      <span className="font-mono text-ink-3 whitespace-nowrap">{goal.id}</span> {goal.title}
                    </Link>
                  </th>
                  <td>
                    <GoalStatus status={goal.status} />
                  </td>
                  <td className="tabular">{met(o)}</td>
                  <td className="tabular">{plural(o.tasks.length, 'task')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      ) : null}
    </Page>
  );
}

function GoalPage({ id, replay }: { id: string; replay: boolean }) {
  const { data: v, error, reload } = useGoal(id);
  if (!v) {
    return (
      <Page testId="goal-page">
        {error ? <LoadNotice what={`goal ${id}`} error={error} stale={false} onRetry={reload} testId="goal-error" /> : <p className="text-ink-3">Opening the goal.</p>}
        <Link to="/goals" className={LINK}>
          All goals
        </Link>
      </Page>
    );
  }
  const { goal, outcome: o } = v;
  const closed = goal.status === 'abandoned' || goal.status === 'done';
  return (
    <Page testId="goal-page">
      <header className="stint-page-header">
        <div className="stint-page-heading">
          <h1 className="stint-page-title">
            <span className="mr-2 font-mono text-section font-normal text-ink-3">{goal.id}</span>
            {goal.title}
          </h1>
          <div className="stint-page-summary flex flex-wrap items-center gap-x-3 gap-y-1">
            <GoalStatus status={goal.status} />
            <span data-testid="goal-met">{met(o)}</span>
            <span>{plural(o.tasks.length, 'task')}</span>
          </div>
          <p className="mt-3 text-ink whitespace-pre-line" data-testid="goal-outcome">
            {goal.outcome}
          </p>
          {goal.nonGoals.length ? <p className="mt-1 text-small text-ink-3">Not in scope: {goal.nonGoals.join('; ')}.</p> : null}
          <Explain word="goal" className="mt-2" />
        </div>
        {closed ? null : <RunGoal v={v} replay={replay} />}
      </header>
      {error ? <LoadNotice what="this goal" error={error} stale onRetry={reload} testId="goal-stale" /> : null}

      <GoalLimits v={v} onChange={reload} />

      <section aria-labelledby="goal-criteria" className="stint-section">
        <h2 id="goal-criteria" className="stint-section-title">
          Criteria
        </h2>
        <Scroller label="Criteria">
          <table className="stint-table table-fixed min-w-[560px]">
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col" className="w-[26%]">
                  State
                </th>
                <th scope="col" className="w-[22%]">
                  Covered by
                </th>
              </tr>
            </thead>
            <tbody>
              {o.criteria.map((c) => (
                <tr key={c.index} data-testid="goal-criterion" data-state={c.state}>
                  <th scope="row" className="font-normal text-ink [overflow-wrap:anywhere]">
                    <span className="tabular text-ink-3">{c.index + 1}.</span> {c.text}
                    <span className="block mt-0.5 text-ink-3">{c.evidence}</span>
                  </th>
                  <td>
                    <StatusChip label={CRITERION_STATE_LABELS[c.state]} {...CRITERION[c.state]} />
                  </td>
                  <td>{c.tasks.length ? <TaskLinks ids={c.tasks} /> : <span className="text-ink-3">No task yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      </section>

      {closed ? null : (
        // Sharpen draws nothing once a started goal has no round open; an empty wrapper takes no room
        <div className="stint-section empty:hidden">
          <Sharpen subject={{ noun: 'goal', id: goal.id, criteria: goal.criteria.map((c) => c.text), started: goal.tasks.length > 0 }} st={v.sharpen} onChange={reload} />
        </div>
      )}

      <section aria-labelledby="goal-tasks" className="stint-section">
        <h2 id="goal-tasks" className="stint-section-title">
          Tasks
        </h2>
        {o.tasks.length ? (
          <Scroller label="Tasks">
            <table className="stint-table min-w-[480px]" data-testid="goal-tasks">
              <thead>
                <tr>
                  {['Task', 'State', 'Covers'].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.tasks.map((t) => {
                  const task = v.tasks.find((x) => x.id === t.id);
                  const waits = (task?.dependsOn ?? []).filter((d) => v.tasks.find((x) => x.id === d)?.status !== 'done');
                  return (
                    <tr key={t.id} data-testid={`goal-task-${t.id}`}>
                      <th scope="row" className="font-normal">
                        <Link to={`/t/${t.id}`} className={cx(LINK, 'inline-flex items-center gap-1 min-h-6 text-ink')}>
                          <span className="font-mono text-ink-3 whitespace-nowrap">{t.id}</span> {task?.title ?? ''}
                        </Link>
                      </th>
                      {/* an outcome once there is one (merged, waiting for you, stopped); before that the task's own status, so a planned task never reads as in progress */}
                      <td data-testid="goal-task-result">
                        {t.result === 'in_progress' && task ? <StatusChip status={task.status} /> : <StatusChip label={t.resultLabel} {...RESULT[t.result]} />}
                        {waits.length && task?.status === 'planned' ? (
                          <span className="block mt-1 text-small text-ink-3" data-testid="goal-task-waits">
                            Waits for <span className="font-mono">{waits.join(', ')}</span> to be merged
                          </span>
                        ) : null}
                      </td>
                      <td className="tabular">{t.covers.length ? `Criteri${t.covers.length === 1 ? 'on' : 'a'} ${t.covers.join(', ')}` : 'None'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Scroller>
        ) : v.proposal ? null : (
          <EmptyState testId="goal-no-tasks">No tasks yet. Split the goal, check the proposed tasks, and they appear here with how each went.</EmptyState>
        )}
        {closed ? null : <Split key={goal.id} id={goal.id} proposal={v.proposal} again={o.tasks.length > 0} onDone={reload} />}
      </section>
      {closed ? null : <Abandon id={goal.id} onDone={reload} />}
    </Page>
  );
}

function TaskLinks({ ids }: { ids: string[] }) {
  return (
    <span className="flex flex-wrap gap-x-2">
      {ids.map((t) => (
        <Link key={t} to={`/t/${t}`} className={cx(LINK, 'inline-flex items-center min-h-6 font-mono')}>
          {t}
        </Link>
      ))}
    </span>
  );
}

/** The goal's builds against its limits with the Limits meters, its spend too once it has a spend limit, and a fold to change the limits. */
function GoalLimits({ v, onChange }: { v: GoalView; onChange: () => void }) {
  const { goal, outcome: o } = v;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const limits = { usd: f.get('usd') ? Number(f.get('usd')) : null, builds: f.get('builds') ? Number(f.get('builds')) : null };
    setBusy(true);
    setError(null);
    api
      .setGoalLimits(goal.id, limits)
      .then(onChange)
      .catch((err: unknown) => setError(daemonMessage(err)))
      .finally(() => setBusy(false));
  };
  const cap = { usd: o.spend.limit, builds: o.builds.limit };
  return (
    <section aria-label="Goal limits" className="stint-section gap-3">
      <ul aria-label="Limits across the goal's tasks" className="grid grid-cols-1 gap-y-1.5 min-[760px]:flex min-[760px]:flex-wrap min-[760px]:items-center gap-x-3 text-small text-ink-2">
        {cap.usd === null ? null : <Meter id="goal-usd" word="Spend" used={o.spend.usd} cap={cap.usd} reached={o.spend.usd >= cap.usd} value={spend(o)} note={o.spend.unpriced ? `, ${o.spend.unpriced} not priced` : ''} />}
        <Meter id="goal-builds" word="Builds" dot={cap.usd !== null} used={o.builds.used} cap={cap.builds} reached={cap.builds !== null && o.builds.used >= cap.builds} value={`${o.builds.used}${cap.builds === null ? '' : ` of ${cap.builds}`}`} />
      </ul>
      <details className="w-fit max-w-full rounded-[5px] border border-rule" data-testid="goal-limits">
        <summary className="min-h-9 px-3 py-2 rounded-[5px] font-medium cursor-pointer hover:bg-surface-hover">Change the goal's limits</summary>
        <form className="flex flex-wrap items-end gap-3 px-3 pb-3" onSubmit={save}>
          <p className="stint-field-help basis-full">Counted across all its tasks. Autopilot stops a build that would go past one. Leave a field empty for no limit.</p>
          <label className="stint-field-group">
            <span className="stint-field-label">Spend in dollars</span>
            <input name="usd" type="number" min={0.01} max={1000} step={0.01} inputMode="decimal" defaultValue={cap.usd ?? ''} className="stint-input w-36 tabular" />
          </label>
          <label className="stint-field-group">
            <span className="stint-field-label">Builds</span>
            <input name="builds" type="number" min={1} max={50} step={1} inputMode="numeric" defaultValue={cap.builds ?? ''} className="stint-input w-28 tabular" />
          </label>
          <Button type="submit" aria-disabled={busy} aria-busy={busy || undefined} data-testid="save-goal-limits">
            {busy ? 'Saving' : 'Save the limits'}
          </Button>
          {error ? (
            <p role="alert" className="stint-field-error basis-full">
              The limits were not changed: {error}
            </p>
          ) : null}
        </form>
      </details>
    </section>
  );
}

const DOING = { split: 'The planner is splitting the goal. The proposed tasks appear here before any is created.', create: 'Creating the tasks.' } as const;

/** "Split into tasks": the planner's proposal as rows a person can edit, then "Create tasks". Nothing is created before. */
function Split({ id, proposal, again, onDone }: { id: string; proposal: ProposedTask[] | null; again: boolean; onDone: () => void }) {
  const [rows, setRows] = useState<ProposedTask[] | null>(proposal);
  // a proposal recorded elsewhere (another tab, the CLI) shows up here, but never over rows a person is editing
  useEffect(() => setRows((now) => now ?? proposal), [proposal]);
  const [busy, setBusy] = useState<keyof typeof DOING | null>(null);
  const [error, setError] = useState<{ doing: keyof typeof DOING; message: string } | null>(null);
  // one request at a time: a second press while one runs does nothing, and a failure leaves the rows as they were
  const run = (doing: keyof typeof DOING, p: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(doing);
    setError(null);
    void p()
      .catch((e: unknown) => setError({ doing, message: daemonMessage(e) }))
      .finally(() => setBusy(null));
  };
  const split = () => run('split', () => api.planGoal(id).then((r) => setRows(r.tasks)));
  const set = (i: number, patch: Partial<ProposedTask>) => setRows((now) => now?.map((r, k) => (k === i ? { ...r, ...patch } : r)) ?? null);
  const create = (e: FormEvent) => {
    e.preventDefault();
    // blank lines in a check list are not checks
    const tasks = rows?.map((r) => ({ ...r, title: r.title.trim(), acceptance: r.acceptance.map((a) => a.trim()).filter(Boolean) }));
    if (tasks)
      run('create', () =>
        api.createGoalTasks(id, tasks).then(() => {
          setRows(null);
          onDone();
        }),
      );
  };
  const status = (
    <>
      <p role="status" className={busy ? 'text-small text-ink-3' : 'sr-only'}>
        {busy ? DOING[busy] : ''}
      </p>
      {error ? (
        <p role="alert" className="stint-field-error" data-testid="split-error">
          {error.doing === 'create' ? 'The tasks were not created' : 'The goal was not split'}: {error.message}
        </p>
      ) : null}
    </>
  );
  const splitLabel = busy === 'split' ? 'Splitting' : null;
  if (!rows) {
    return (
      <div className="flex flex-col gap-2" data-testid="goal-split">
        <Button tone={again ? 'quiet' : 'primary'} className="self-start" aria-disabled={!!busy} aria-busy={busy === 'split' || undefined} onClick={split} data-testid="split-goal">
          {splitLabel ?? (again ? 'Split again into more tasks' : 'Split into tasks')}
        </Button>
        {status}
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={create} data-testid="goal-proposal" aria-labelledby="proposal-title">
      <div>
        <h3 id="proposal-title" className="font-semibold">
          Proposed tasks
        </h3>
        <p className="mt-1 text-small text-ink-3">Nothing is created yet. Change a title or a check, then create them. Each task starts with the goal's decisions and its share of the goal's limits.</p>
      </div>
      <ol className="flex flex-col gap-3">
        {rows.map((t, i) => (
          <li key={i} data-testid={`proposed-${i + 1}`}>
            <fieldset className="grid min-w-0 gap-4 p-4 rounded-[5px] border border-rule bg-panel">
              <legend className="px-1 font-semibold">Task {i + 1}</legend>
              <p className="text-small text-ink-3">
                {t.covers.length ? `Covers criteri${t.covers.length === 1 ? 'on' : 'a'} ${t.covers.join(', ')}` : 'Covers no criterion'}
                {t.dependsOn.length ? `; starts after task ${t.dependsOn.map((d) => d + 1).join(', ')} is merged` : ''}. {t.goal}
              </p>
              <label className="stint-field-group">
                <span className="stint-field-label">Title</span>
                <input value={t.title} required maxLength={120} onChange={(e) => set(i, { title: e.target.value })} className="stint-input" />
              </label>
              <label className="stint-field-group">
                <span className="stint-field-label">How you will know it is done, one check per line</span>
                <textarea
                  value={t.acceptance.join('\n')}
                  required
                  rows={Math.min(6, Math.max(2, t.acceptance.length))}
                  onChange={(e) => set(i, { acceptance: e.target.value.split('\n').map((l) => l.slice(0, 300)).slice(0, 8) })}
                  className="stint-input min-h-0"
                />
              </label>
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="stint-actions">
        <Button tone="primary" type="submit" aria-disabled={!!busy || rows.some((r) => !r.title.trim() || !r.acceptance.some((a) => a.trim()))} aria-busy={busy === 'create' || undefined} data-testid="create-goal-tasks">
          {busy === 'create' ? 'Creating tasks' : 'Create tasks'}
        </Button>
        <Button aria-disabled={!!busy} aria-busy={busy === 'split' || undefined} onClick={split}>
          {splitLabel ?? 'Ask for another split'}
        </Button>
      </div>
      {status}
    </form>
  );
}

const CLOSED_TASK = ['done', 'approved', 'abandoned'];

/**
 * "Run the goal's tasks": every open task of the goal on autopilot, in the goal's order (POST /api/goals/:id/run). It
 * says what it starts and under which limits before the press, which the goal's meters above repeat; a second press
 * while the request runs does nothing.
 */
function RunGoal({ v, replay }: { v: GoalView; replay: boolean }) {
  const [busy, setBusy] = useState(false);
  // the first press asks, like the Board's Run all: it says what starts and under which limits, and only Start starts it
  const [asking, setAsking] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // the same reasons the Board's Run all is off: nothing runs in the replay or the read-only copy
  const off = readOnly ?? (replay ? 'Not in the replay: nothing runs here.' : null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string[] | null>(null);
  // a task at the gate is not open work: it waits for your approval, and the daemon does not start it
  const open = v.tasks.filter((t) => !CLOSED_TASK.includes(t.status) && t.status !== 'awaiting_approval');
  if (!open.length) return null;
  const waiting = open.filter((t) => t.dependsOn.some((d) => v.tasks.find((x) => x.id === d)?.status !== 'done')).map((t) => t.id);
  const now = open.filter((t) => !waiting.includes(t.id)).map((t) => t.id);
  const { spend, builds } = v.outcome;
  const caps = [spend.limit === null ? 'no spend limit' : `a spend limit of ${money({ usd: spend.limit })}`, builds.limit === null ? 'no build limit' : `a build limit of ${builds.limit} (${builds.used} used)`];
  const close = () => {
    setAsking(false);
    requestAnimationFrame(() => opener.current?.focus());
  };
  const ask = () => {
    if (busy || off) return;
    setError(null);
    setAsking(true);
    requestAnimationFrame(() => confirm.current?.focus());
  };
  const run = () => {
    if (busy || off) return;
    setBusy(true);
    setError(null);
    api
      .runGoal(v.goal.id)
      .then((r) => {
        setStarted(r.started);
        close();
      })
      .catch((e: unknown) => setError(daemonMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div
      className="flex flex-col gap-2 lg:items-end lg:max-w-[46ch]"
      data-testid="run-goal"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && asking && !busy) close();
      }}
    >
      <div className="stint-actions lg:justify-end">
        {asking ? (
          <>
            <Button ref={confirm} tone="primary" aria-disabled={busy} aria-busy={busy || undefined} aria-describedby="run-goal-what" onClick={run} data-testid="run-goal-confirm">
              {busy ? 'Starting autopilot' : `Start ${plural(open.length, 'task')}`}
            </Button>
            <Button tone="ghost" aria-disabled={busy} onClick={close} data-testid="run-goal-cancel">
              Cancel
            </Button>
          </>
        ) : (
          <Button ref={opener} tone="primary" aria-disabled={off !== null} aria-describedby="run-goal-what" onClick={ask} data-testid="run-goal-button">
            {`Run the goal's ${plural(open.length, 'task')}`}
          </Button>
        )}
      </div>
      {asking ? (
        <p className="stint-field-help max-w-[60ch] text-ink lg:text-right" id="run-goal-what" role="status" data-testid="run-goal-ask">
          Autopilot plans, builds, tests and reviews {waiting.length ? `${now.join(', ') || 'none'} now, and ${waiting.join(', ')} once the tasks ${waiting.length === 1 ? 'it waits' : 'they wait'} on are merged` : now.length === 1 ? now[0] : `${now.join(', ')}`}, then stops for your approval. Nothing is merged without you. The goal has {caps.join(' and ')}.
        </p>
      ) : (
        <p className="stint-field-help max-w-[60ch] lg:text-right" id="run-goal-what">
          Puts the goal's {plural(open.length, 'open task')} on autopilot, in order: each is planned, built, tested and reviewed, then stops for your approval.
          {waiting.length ? ` ${waiting.join(', ')} ${waiting.length === 1 ? 'starts' : 'start'} only once the tasks ${waiting.length === 1 ? 'it waits' : 'they wait'} on are merged.` : ''} The goal has {caps.join(' and ')}.
          {off ? <span className="block mt-1 text-ink-2">{off}</span> : null}
        </p>
      )}
      {started ? (
        <p role="status" className="text-small text-ink-2" data-testid="run-goal-started">
          {started.length ? `On autopilot: ${started.join(', ')}.` : 'No open task to start.'}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="stint-field-error" data-testid="run-goal-error">
          The tasks were not started: {error}
        </p>
      ) : null}
    </div>
  );
}

/** Abandoning is a person's call and not undone, so it takes two clicks: the first says what will happen, the second does it. */
function Abandon({ id, onDone }: { id: string; onDone: () => void }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abandon = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api
      .abandonGoal(id)
      .then(onDone)
      .catch((e: unknown) => setError(daemonMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <section aria-label="Abandon the goal" className="stint-section justify-items-start gap-2 pt-6 border-t border-rule">
      {armed ? <p role="status" className="text-small text-ink-2">Abandoning stops counting this goal. Its tasks stay as they are. Click again to abandon {id}.</p> : null}
      <div className="stint-actions">
        <Button tone={armed ? 'danger' : 'quiet'} aria-disabled={busy} aria-busy={busy || undefined} onClick={armed ? abandon : () => setArmed(true)} data-testid="abandon-goal">
          {busy ? 'Abandoning' : armed ? `Abandon ${id}` : 'Abandon this goal'}
        </Button>
        {armed ? (
          <Button tone="ghost" aria-disabled={busy} onClick={() => setArmed(false)}>
            Keep it
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="stint-field-error">
          {id} was not abandoned: {error}
        </p>
      ) : null}
    </section>
  );
}
