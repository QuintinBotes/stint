import { CRITERION_STATE_LABELS, type CriterionState, type GoalOutcome, type ProposedTask } from '@stint-dev/core';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { type GoalView, api, daemonMessage } from '../api';
import { Meter } from '../components/Limits';
import { Sharpen } from '../components/SharpenPanel';
import { Button, EmptyState, Explain, StatusChip, cx, rev } from '../components/ui';
import { money, moneyOf } from '../format';
import { useGoal, useGoals } from '../hooks';

// green only for proven, amber only for failing, ink for the rest, as How it went shows a task's criteria
const INK: Partial<Record<CriterionState, string>> = { proven: 'text-green', failing: 'text-amber' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const met = (o: GoalOutcome) => `${o.met} of ${plural(o.criteria.length, 'criterion', 'criteria')} met`;
const spend = (o: GoalOutcome) => moneyOf(o.spend.usd, o.spend.limit);
const field = 'w-full rounded-[5px] border border-field bg-ground px-3 py-2 text-ink placeholder:text-ink-3';

function Page({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <main className="relative flex-1 min-h-0 overflow-y-auto" data-testid={testId}>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-5 pb-8 md:pt-7 md:pb-10 flex flex-col gap-6">{children}</div>
    </main>
  );
}

/** A wide table scrolls sideways on its own on a phone, so the page never does. */
function Scroller({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto p-px" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** Goals (R-064): the list at /goals, one goal at /goals/:id. */
export function Goals({ onNewGoal }: { onNewGoal: () => void }) {
  const { id } = useParams();
  return id ? <GoalPage id={id} /> : <GoalList onNewGoal={onNewGoal} />;
}

function GoalList({ onNewGoal }: { onNewGoal: () => void }) {
  const { data: goals, error } = useGoals();
  return (
    <Page testId="goals">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5 max-w-[75ch] min-w-0">
          <h1 className="text-title">Goals</h1>
          <p>{goals === null ? (error ? `The goals did not load: ${error}` : 'Reading the goals.') : 'Each goal is an outcome bigger than one task. Stint splits it into tasks, and each criterion shows how the tasks covering it went.'}</p>
          <Explain word="goal" />
        </div>
        <Button tone="primary" onClick={onNewGoal} data-testid="new-goal">
          New goal
        </Button>
      </header>
      {goals?.length === 0 ? <EmptyState testId="goals-empty">No goals yet: make one, and the tasks Stint splits it into appear under it.</EmptyState> : null}
      {goals?.length ? (
        <Scroller label="Goals">
          <table className={cx(rev.table, 'min-w-[640px]')} data-testid="goal-list">
            <thead>
              <tr>
                {['Goal', 'Status', 'Criteria', 'Tasks', 'Spend'].map((h) => (
                  <th key={h} scope="col" className={rev.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {goals.map(({ goal, outcome: o }) => (
                <tr key={goal.id} data-testid={`goal-row-${goal.id}`}>
                  <th scope="row" className={cx(rev.td, 'font-normal')}>
                    <Link to={`/goals/${goal.id}`} className="underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                      <span className="font-mono text-ink-2">{goal.id}</span> {goal.title}
                    </Link>
                  </th>
                  <td className={rev.td}>
                    <StatusChip status={goal.status} />
                  </td>
                  <td className={rev.td}>{met(o)}</td>
                  <td className={rev.td}>{plural(o.tasks.length, 'task')}</td>
                  <td className={rev.td}>{spend(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      ) : null}
    </Page>
  );
}

function GoalPage({ id }: { id: string }) {
  const { data: v, error, reload } = useGoal(id);
  if (!v) {
    return (
      <Page testId="goal-page">
        <p className="text-ink-2">{error ? `There is no goal ${id} here: ${error}` : 'Opening the goal.'}</p>
        <Link to="/goals" className="underline underline-offset-4">
          All goals
        </Link>
      </Page>
    );
  }
  const { goal, outcome: o, titles } = v;
  const closed = goal.status === 'abandoned' || goal.status === 'done';
  return (
    <Page testId="goal-page">
      <header className="flex flex-col gap-2 max-w-[80ch] min-w-0">
        <h1 className="text-title">
          <span className="font-mono text-ink-2">{goal.id}</span> {goal.title}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-2">
          <StatusChip status={goal.status} />
          <span data-testid="goal-met">{met(o)}</span>
          <span>{plural(o.tasks.length, 'task')}</span>
        </p>
        <p data-testid="goal-outcome">{goal.outcome}</p>
        {goal.nonGoals.length ? <p className="text-small text-ink-2">Not in scope: {goal.nonGoals.join('; ')}.</p> : null}
        <Explain word="goal" />
      </header>

      <GoalLimits v={v} onChange={reload} />

      <section aria-labelledby="goal-criteria" className="flex flex-col gap-2">
        <h2 id="goal-criteria" className="text-section">
          Criteria
        </h2>
        <Scroller label="Criteria">
          <table className={cx(rev.table, 'table-fixed min-w-[560px]')}>
            <thead>
              <tr>
                <th scope="col" className={rev.th}>
                  Criterion
                </th>
                <th scope="col" className={cx(rev.th, 'w-[26%]')}>
                  State
                </th>
                <th scope="col" className={cx(rev.th, 'w-[22%]')}>
                  Covered by
                </th>
              </tr>
            </thead>
            <tbody>
              {o.criteria.map((c) => (
                <tr key={c.index} data-testid="goal-criterion" data-state={c.state}>
                  <th scope="row" className={cx(rev.td, 'font-normal [overflow-wrap:anywhere]')}>
                    <span className="tabular text-ink-2">{c.index + 1}.</span> {c.text}
                    <span className="block mt-0.5 text-ink-2">{c.evidence}</span>
                  </th>
                  <td className={cx(rev.td, 'font-medium', INK[c.state] ?? 'text-ink')}>{CRITERION_STATE_LABELS[c.state]}</td>
                  <td className={rev.td}>{c.tasks.length ? <TaskLinks ids={c.tasks} /> : <span className="text-ink-2">No task yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      </section>

      {closed ? null : <Sharpen subject={{ noun: 'goal', id: goal.id, criteria: goal.criteria.map((c) => c.text), started: goal.tasks.length > 0 }} st={v.sharpen} onChange={reload} />}

      <section aria-labelledby="goal-tasks" className="flex flex-col gap-3">
        <h2 id="goal-tasks" className="text-section">
          Tasks
        </h2>
        {o.tasks.length ? (
          <Scroller label="Tasks">
            <table className={cx(rev.table, 'min-w-[480px]')} data-testid="goal-tasks">
              <thead>
                <tr>
                  {['Task', 'Result', 'Covers'].map((h) => (
                    <th key={h} scope="col" className={rev.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.tasks.map((t) => (
                  <tr key={t.id} data-testid={`goal-task-${t.id}`}>
                    <th scope="row" className={cx(rev.td, 'font-normal')}>
                      <Link to={`/t/${t.id}`} className="inline-flex items-center gap-1 min-h-6 underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                        <span className="font-mono text-ink-2">{t.id}</span> {titles[t.id] ?? ''}
                      </Link>
                    </th>
                    <td className={rev.td} data-testid="goal-task-result">
                      {t.resultLabel}
                    </td>
                    <td className={cx(rev.td, 'tabular')}>{t.covers.length ? `Criteri${t.covers.length === 1 ? 'on' : 'a'} ${t.covers.join(', ')}` : 'None'}</td>
                  </tr>
                ))}
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
        <Link key={t} to={`/t/${t}`} className="inline-flex items-center min-h-6 font-mono underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
          {t}
        </Link>
      ))}
    </span>
  );
}

/** The goal's spend and builds against its limits, with the Limits meters, and a fold to change the limits. */
function GoalLimits({ v, onChange }: { v: GoalView; onChange: () => void }) {
  const { goal, outcome: o } = v;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
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
    <section aria-label="Goal limits" className="flex flex-col gap-2">
      <ul aria-label="Spend and builds across the goal's tasks" className="grid grid-cols-1 gap-y-1.5 min-[760px]:flex min-[760px]:flex-wrap min-[760px]:items-center gap-x-3 text-small text-ink-2">
        <Meter id="goal-usd" word="Spend" used={o.spend.usd} cap={cap.usd} reached={cap.usd !== null && o.spend.usd >= cap.usd} value={spend(o)} note={o.spend.unpriced ? `, ${o.spend.unpriced} not priced` : ''} />
        <Meter id="goal-builds" word="Builds" dot used={o.builds.used} cap={cap.builds} reached={cap.builds !== null && o.builds.used >= cap.builds} value={`${o.builds.used}${cap.builds === null ? '' : ` of ${cap.builds}`}`} />
      </ul>
      <details className="w-fit max-w-full rounded-[5px] border border-rule" data-testid="goal-limits">
        <summary className="min-h-9 px-3 py-2 rounded-[5px] font-medium cursor-pointer hover:bg-panel-2">Change the goal's limits</summary>
        <form className="flex flex-wrap items-end gap-3 px-3 pb-3" onSubmit={save}>
          <p className="basis-full text-small text-ink-2">Counted across all its tasks. Autopilot stops a build that would go past one. Leave a field empty for no limit.</p>
          <label className="flex flex-col gap-1.5 font-medium">
            Spend in dollars
            <input name="usd" type="number" min={0.01} max={1000} step={0.01} inputMode="decimal" defaultValue={cap.usd ?? ''} className={cx(field, 'w-36 tabular')} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium">
            Builds
            <input name="builds" type="number" min={1} max={50} step={1} inputMode="numeric" defaultValue={cap.builds ?? ''} className={cx(field, 'w-28 tabular')} />
          </label>
          <Button type="submit" disabled={busy}>
            Save the limits
          </Button>
          {error ? (
            <p role="alert" className="basis-full text-red">
              The limits were not changed: {error}
            </p>
          ) : null}
        </form>
      </details>
    </section>
  );
}

/** "Split into tasks": the planner's proposal as rows a person can edit, then "Create tasks". Nothing is created before. */
function Split({ id, proposal, again, onDone }: { id: string; proposal: ProposedTask[] | null; again: boolean; onDone: () => void }) {
  const [rows, setRows] = useState<ProposedTask[] | null>(proposal);
  // a proposal recorded elsewhere (another tab, the CLI) shows up here, but never over rows a person is editing
  useEffect(() => setRows((now) => now ?? proposal), [proposal]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (doing: string, p: Promise<unknown>) => {
    setBusy(doing);
    setError(null);
    return p.catch((e: unknown) => setError(daemonMessage(e))).finally(() => setBusy(null));
  };
  const split = () => void run('The planner is splitting the goal. The proposed tasks appear here before any is created.', api.planGoal(id).then((r) => setRows(r.tasks)));
  const set = (i: number, patch: Partial<ProposedTask>) => setRows((now) => now?.map((r, k) => (k === i ? { ...r, ...patch } : r)) ?? null);
  const create = (e: FormEvent) => {
    e.preventDefault();
    // blank lines in a check list are not checks
    const tasks = rows?.map((r) => ({ ...r, title: r.title.trim(), acceptance: r.acceptance.map((a) => a.trim()).filter(Boolean) }));
    if (tasks)
      void run(
        'Creating the tasks.',
        api.createGoalTasks(id, tasks).then(() => {
          setRows(null);
          onDone();
        }),
      );
  };
  const status = (
    <>
      <p role="status" className={busy ? 'text-small text-ink-2' : 'sr-only'}>
        {busy}
      </p>
      {error ? (
        <p role="alert" className="text-small text-red">
          {error}
        </p>
      ) : null}
    </>
  );
  if (!rows) {
    return (
      <div className="flex flex-col gap-2" data-testid="goal-split">
        <Button tone={again ? 'quiet' : 'primary'} className="self-start" disabled={!!busy} onClick={split} data-testid="split-goal">
          {again ? 'Split again into more tasks' : 'Split into tasks'}
        </Button>
        {status}
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={create} data-testid="goal-proposal" aria-labelledby="proposal-title">
      <div>
        <h3 id="proposal-title" className="font-semibold">
          Proposed tasks
        </h3>
        <p className="text-small text-ink-2">Nothing is created yet. Change a title or a check, then create them. Each task starts with the goal's decisions and its share of the goal's limits.</p>
      </div>
      <ol className="flex flex-col gap-3">
        {rows.map((t, i) => (
          <li key={i} data-testid={`proposed-${i + 1}`}>
            <fieldset className="flex min-w-0 flex-col gap-2 p-3 rounded-[5px] border border-rule-strong bg-panel">
              <legend className="px-1 font-medium">Task {i + 1}</legend>
              <p className="text-small text-ink-2">
                {t.covers.length ? `Covers criteri${t.covers.length === 1 ? 'on' : 'a'} ${t.covers.join(', ')}` : 'Covers no criterion'}
                {t.dependsOn.length ? `; starts after task ${t.dependsOn.map((d) => d + 1).join(', ')} is merged` : ''}. {t.goal}
              </p>
              <label className="flex flex-col gap-1.5 font-medium">
                Title
                <input value={t.title} required maxLength={120} onChange={(e) => set(i, { title: e.target.value })} className={field} />
              </label>
              <label className="flex flex-col gap-1.5 font-medium">
                How you will know it is done, one check per line
                <textarea
                  value={t.acceptance.join('\n')}
                  required
                  rows={Math.min(6, Math.max(2, t.acceptance.length))}
                  onChange={(e) => set(i, { acceptance: e.target.value.split('\n').map((l) => l.slice(0, 300)).slice(0, 8) })}
                  className={field}
                />
              </label>
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button tone="primary" type="submit" disabled={!!busy || rows.some((r) => !r.title.trim() || !r.acceptance.some((a) => a.trim()))} data-testid="create-goal-tasks">
          Create tasks
        </Button>
        <Button disabled={!!busy} onClick={split}>
          Ask for another split
        </Button>
      </div>
      {status}
    </form>
  );
}

/** Abandoning is a person's call and not undone, so it takes two clicks: the first says what will happen, the second does it. */
function Abandon({ id, onDone }: { id: string; onDone: () => void }) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abandon = () =>
    void api
      .abandonGoal(id)
      .then(onDone)
      .catch((e: unknown) => setError(daemonMessage(e)));
  return (
    <section aria-label="Abandon the goal" className="flex flex-col gap-2 items-start">
      {armed ? <p role="status" className="text-small text-ink-2">Abandoning stops counting this goal. Its tasks stay as they are. Click again to abandon {id}.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button tone="quiet" onClick={armed ? abandon : () => setArmed(true)} data-testid="abandon-goal">
          {armed ? `Abandon ${id}` : 'Abandon this goal'}
        </Button>
        {armed ? <Button tone="quiet" onClick={() => setArmed(false)}>Keep it</Button> : null}
      </div>
      {error ? <p role="alert" className="text-small text-red">{error}</p> : null}
    </section>
  );
}
