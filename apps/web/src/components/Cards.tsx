import { type Handoff, type Plan, type Review, countTokens, renderHandoff } from '@stint-dev/core';
import { useState } from 'react';
import { JsonView, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { Link } from 'react-router';
import { type Agent, agentOf, hostName, modelName } from '../agents';
import { CostMeter, EmptyState, Section, StatusChip, Who, cx, rev, tabClass } from './ui';

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-ink-3">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1 list-disc pl-[18px] marker:text-ink-3">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

/** Past the point where a card fills: what was never made is said as such, not promised for later. */
const SETTLED = new Set(['awaiting_approval', 'approved', 'done', 'rejected', 'abandoned', 'in_review']);

/** An empty card: the sentence for the task's state, and that state beside it. `settled` is said once the task is past it. */
function PlannedEmpty({ testId, status = 'planned', children, settled }: { testId: string; status?: string; children: string; settled: string }) {
  return (
    <div className="flex items-center gap-2">
      <StatusChip status={status} />
      <EmptyState testId={testId}>{SETTLED.has(status) ? settled : children}</EmptyState>
    </div>
  );
}

/** One field of the packet: its heading with a count, then what the packet says. */
function Field({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="py-3 border-t border-rule text-small">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <h3 className="text-body font-semibold">{title}</h3>
        {count !== undefined ? <span className="text-ink-3 tabular">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Left-out items, with the step that was in flight when a run was killed called out first, in red. */
function LeftOut({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-ink-3">The agent said it left nothing out.</p>;
  return (
    <ul className="flex flex-col gap-1 list-disc pl-[18px] marker:text-ink-3">
      {items.map((i) => (
        <li key={i} className={cx(/^In-flight step unknown/.test(i) && 'text-red')}>
          {i}
        </li>
      ))}
    </ul>
  );
}

const VIEWS = [
  ['packet', 'Packet'],
  ['prompt', 'As the prompt'],
  ['json', 'Raw JSON'],
] as const;

/** The packet a run left: its title-block table, then the fields, the prompt the next agent reads, or the raw JSON. */
export function HandoffCard({ handoff, status, name }: { handoff: Handoff | null; status?: string; name?: string | null }) {
  const [view, setView] = useState<'packet' | 'prompt' | 'json'>('packet');
  if (!handoff)
    return (
      <PlannedEmpty testId="empty-packet" status={status} settled="No run on this task left a packet.">
        The packet appears here when a run ends, however it ends.
      </PlannedEmpty>
    );
  const prompt = renderHandoff(handoff);
  const bytes = new TextEncoder().encode(prompt).length;
  const tokenCount = countTokens(prompt);
  const from = agentOf(handoff.from.adapter, handoff.from.host, handoff.from.model);
  // a packet for a planner or reviewer call names the role; there is no harness to name
  const to: Agent | null = handoff.to ? (handoff.to.adapter === 'openai-compatible' ? { name: `The ${handoff.to.role}`, mark: 'meta' } : agentOf(handoff.to.adapter)) : null;
  const stopped = handoff.from.endedBy === 'killed' || handoff.from.endedBy === 'failed';
  const v = handoff.verification;
  const th = cx('w-[34%]', rev.th);
  const td = rev.td;
  return (
    <article data-testid="handoff-card" className="flex flex-col gap-4 max-w-[760px]">
      <h2 className="text-section">
        <span className="font-mono font-normal text-ink-3 mr-2.5">{handoff.task}</span>
        Packet {name ?? handoff.from.run}
      </h2>
      {/* the heavy ink-3 line goes round the caption too */}
      <div className="outline outline-ink-3">
        <table className={rev.table}>
          <caption className={cx(rev.caption, 'font-mono')}>{handoff.version}</caption>
          <tbody>
            <tr>
              <th scope="row" className={th}>
                From
              </th>
              <td className={td}>
                <Who agent={from} className="font-semibold" />, {handoff.from.run}
                {handoff.from.model ? <span className="text-ink-2">, {modelName(handoff.from.model)}</span> : null}
              </td>
            </tr>
            <tr>
              <th scope="row" className={th}>
                To
              </th>
              <td className={td}>{to ? <Who agent={to} className="font-semibold" /> : <span className="text-ink-2">Whoever you hand it to, below</span>}</td>
            </tr>
            <tr>
              <th scope="row" className={th}>
                Ended by
              </th>
              <td className={cx(td, stopped && 'text-red')}>
                <StatusChip status={handoff.from.endedBy} />
                {stopped ? ' Built from the event log and the worktree; a stopped session cannot add to it.' : null}
              </td>
            </tr>
            <tr>
              <th scope="row" className={th}>
                Size
              </th>
              <td className={cx(td, 'tabular')} data-testid="packet-size">
                {tokenCount} tokens, {(bytes / 1024).toFixed(1)} KB
              </td>
            </tr>
            <tr>
              <th scope="row" className={th}>
                Hash
              </th>
              <td className={cx(td, 'font-mono break-all')} title={handoff.hash}>
                {handoff.hash.slice(0, 15)}…{handoff.hash.slice(-4)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap border-b border-rule" role="tablist" aria-label="Packet view">
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={tabClass(view === k)}>
            {label}
          </button>
        ))}
      </div>
      {view === 'prompt' ? (
        <pre className="font-mono text-code whitespace-pre-wrap break-words rounded-[5px] bg-term text-term-ink px-4 py-3.5">{prompt}</pre>
      ) : view === 'json' ? (
        <div data-testid="packet-json">
          <JsonView data={handoff} shouldExpandNode={(level) => level < 2} style={JSON_STYLE} />
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="mb-1.5 rounded-[5px] border border-amber bg-amber-wash px-3.5 py-3">
            <h3 className="font-semibold mb-1">Ask of next</h3>
            <p data-testid="ask-of-next">{handoff.askOfNext}</p>
          </div>
          <Field title="Where it got to">
            <p>{handoff.summary}</p>
          </Field>
          <Field title="Done" count={handoff.done.length}>
            <List items={handoff.done} empty="Nothing recorded as done." />
          </Field>
          <Field title="Open" count={handoff.open.length}>
            <List items={handoff.open} empty="Nothing open." />
          </Field>
          <Field title="Left out" count={handoff.leftOut.length}>
            <LeftOut items={handoff.leftOut} />
          </Field>
          <Field title="Decisions" count={handoff.decisions.length}>
            {handoff.decisions.length ? (
              <ul className="flex flex-col gap-1">
                {handoff.decisions.map((d) => (
                  <li key={d.id}>
                    <span className="font-mono font-semibold mr-2">{d.id}</span>
                    {d.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-3">No decisions yet.</p>
            )}
          </Field>
          <Field title="Risks" count={handoff.risks.length}>
            <List items={handoff.risks} empty="No risks named." />
            <p className="mt-1 text-ink-2">Refused actions: {(handoff.refusals ?? []).length ? (handoff.refusals ?? []).map((r) => `${r.action} (${r.reason ?? r.by})`).join('; ') : 'none'}</p>
          </Field>
          <Field title="Files" count={handoff.changedFiles.length}>
            {handoff.changedFiles.length ? (
              <ul className="flex flex-col gap-1 font-mono">
                {handoff.changedFiles.map((f) => (
                  <li key={f.path} className="flex gap-3">
                    <span className="truncate">{f.path}</span>
                    <span className="tabular text-ink-2">
                      +{f.added} -{f.removed}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-3">No files changed in this run.</p>
            )}
          </Field>
          <Field title="Verification">
            <p className={cx(!v && 'text-ink-2')}>
              {v ? `${v.status ?? (v.exitCode === 0 ? 'green' : 'red')}, ${v.passed} passed, ${v.failed} failed, run by the daemon` : stopped ? 'Not run: the run stopped before the daemon could test it.' : 'Not run yet.'}
            </p>
          </Field>
          <Field title="Cost so far">
            <CostMeter cost={handoff.cost} detail />
          </Field>
        </div>
      )}
    </article>
  );
}

const LENS_NAMES: Record<string, string> = { general: 'General', security: 'Security', 'spec-fit': 'Spec fit' };

/** `decisions` are the task's recorded decisions, so a finding that would reverse one shows what it would reverse. */
/** The raw packet as a tree that folds, in the app's own colours; only the indentation and icons come from the library. */
const JSON_STYLE = {
  ...darkStyles,
  container: 'font-mono text-code bg-term text-term-ink rounded-[5px] px-4 py-3.5 overflow-x-auto',
  label: 'text-ink-2 mr-1',
  clickableLabel: 'text-ink-2 mr-1 cursor-pointer',
  stringValue: 'text-term-ink break-words',
  numberValue: 'text-ink-2',
  booleanValue: 'text-ink-2',
  nullValue: 'text-ink-3',
  undefinedValue: 'text-ink-3',
  otherValue: 'text-ink',
  punctuation: 'text-ink-3',
};

export function ReviewCard({ review, decisions = [], status }: { review: Review | null; decisions?: Array<{ id: string; text: string }>; status?: string }) {
  if (!review)
    return (
      <PlannedEmpty testId="empty-review" status={status} settled="No review was recorded on this task.">
        The review appears here after a green verification.
      </PlannedEmpty>
    );
  return (
    <article data-testid="review-card" className="flex flex-col gap-3 max-w-[72ch]">
      <header className="flex flex-wrap items-center gap-2">
        <StatusChip label={review.verdict.replace('_', ' ')} tone={review.verdict === 'approve' ? 'good' : review.verdict === 'block' ? 'bad' : 'warn'} />
        {review.offline ? <StatusChip label="offline" tone="neutral" /> : null}
        <span className="text-ink-2">
          {review.lens === 'combined' ? 'combined from the reviews below' : modelName(review.model)}
          {review.cost ? (
            <>
              , <CostMeter cost={review.cost} />
            </>
          ) : null}
        </span>
      </header>
      {review.lenses?.length ? (
        <ul className="flex flex-col gap-1 text-small" data-testid="review-lenses">
          {review.lenses.map((l, i) => (
            <li key={`${l.lens}-${l.run ?? i}`} className="flex flex-wrap items-center gap-2" data-lens={l.lens}>
              <span className="font-semibold w-[72px]">{LENS_NAMES[l.lens] ?? l.lens}</span>
              <StatusChip label={l.verdict.replace('_', ' ')} tone={l.verdict === 'approve' ? 'good' : l.verdict === 'block' ? 'bad' : 'warn'} />
              <span className="text-ink-2">
                {modelName(l.model)}, {l.findings} finding{l.findings === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {review.disagreement ? (
        <p data-testid="review-disagreement" className="text-amber">
          The reviewers did not agree on the verdict. The strictest one counts; read their findings before you approve.
        </p>
      ) : null}
      {review.blockers.length ? (
        <section data-testid="review-blockers" aria-label="Blockers">
          <h3 className="font-semibold text-red">
            {review.blockers.length} blocker{review.blockers.length === 1 ? '' : 's'}
          </h3>
          <ul className="mt-1 flex flex-col gap-1 list-disc pl-4 marker:text-red">
            {review.blockers.map((b) => (
              <li key={b} className="text-red">
                {b}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {review.findings.length === 0 ? (
        <p data-testid="no-findings">No actionable findings.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {review.findings.map((f) => (
            <li key={f.id} data-testid="finding" className="border-t border-rule pt-3 pb-1">
              <div className="flex flex-wrap items-center gap-2 text-small">
                <span className="font-mono font-semibold">{f.id}</span>
                <StatusChip label={f.severity} tone={f.severity === 'blocker' ? 'bad' : f.severity === 'major' ? 'warn' : 'neutral'} />
                {f.file ? (
                  <Link to={`?tab=diff&file=${encodeURIComponent(f.file)}`} className="font-mono text-ink-2 underline-offset-2 hover:text-ink hover:underline" data-testid="finding-file">
                    {f.file}
                    {f.line ? `:${f.line}` : ''}
                  </Link>
                ) : null}
                {f.contradictsDecision ? (
                  <Link to="/factory" className="rounded-sm" data-testid="finding-queue">
                    <StatusChip label={`contradicts ${f.contradictsDecision}, routed to the queue`} tone="warn" />
                  </Link>
                ) : null}
                {review.lens === 'combined' && f.lens ? <StatusChip label={LENS_NAMES[f.lens] ?? f.lens} tone="neutral" /> : null}
                {f.agreement && f.agreement > 1 ? <span className="text-ink-2">found by {f.agreement} reviewers</span> : null}
              </div>
              <p className="mt-1">{f.text}</p>
              {f.contradictsDecision ? (
                <p className="mt-2 rounded-[3px] border border-amber bg-amber-wash px-2.5 py-2 text-small" data-testid="contradicted-decision">
                  {f.contradictsDecision}: {decisions.find((d) => d.id === f.contradictsDecision)?.text ?? 'not found in this task\'s decisions'}. The decision stands until you settle it in the queue.
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {review.summary && review.findings.length > 0 ? <p className="text-ink-2">{review.summary}</p> : null}
    </article>
  );
}

const STEP_STOP = new Set(['the', 'and', 'with', 'when', 'that', 'this', 'from', 'into', 'for', 'are', 'its', 'per']);

/** Key words of a step or a packet entry, lightly stemmed so tests and test are the same word. */
const stepWords = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
      .filter((w) => w.length >= 3 && !STEP_STOP.has(w)),
  );

/**
 * How strongly a packet entry names a step: an exact id or text match outranks everything;
 * the agent's own words score by shared key words, and two shared words count as the same step.
 */
function stepScore(entry: string, step: { id: number; text: string }): number {
  const text = entry.trim().toLowerCase();
  if (text === String(step.id) || text === `step ${step.id}` || text === step.text.trim().toLowerCase()) return 1000;
  const want = stepWords(step.text);
  if (want.size === 0) return 0;
  const have = stepWords(entry);
  return [...want].filter((w) => have.has(w)).length;
}

/** Each step, done or open, from the latest packet's lists; the list that names it best decides. */
export function planStepStates(plan: Plan, handoff: Handoff | null | undefined): Array<'done' | 'open'> {
  const best = (entries: string[], step: { id: number; text: string }) => Math.max(0, ...entries.map((e) => stepScore(e, step)));
  return plan.steps.map((s) => {
    const need = Math.min(2, Math.max(1, stepWords(s.text).size));
    const done = best(handoff?.done ?? [], s);
    const open = best(handoff?.open ?? [], s);
    return done >= need && done >= open ? 'done' : 'open';
  });
}

export function PlanCard({ plan, handoff, status }: { plan: Plan | null; handoff?: Handoff | null; status?: string }) {
  if (!plan)
    return (
      <PlannedEmpty testId="empty-plan" status={status} settled="No plan was made for this task.">
        The plan arrives here when the planner finishes.
      </PlannedEmpty>
    );
  const [host, model] = plan.model.includes('/') ? plan.model.split('/') : [null, plan.model];
  const states = planStepStates(plan, handoff);
  const doneCount = states.filter((s) => s === 'done').length;
  const state = doneCount === plan.steps.length ? 'done' : doneCount > 0 ? 'building' : 'planned';
  return (
    <article data-testid="plan-card" className="flex flex-col gap-2 max-w-[72ch]">
      <header className="flex flex-wrap items-center gap-2">
        <StatusChip status={state} />
        <p className="text-ink-2">
          Planned by {modelName(model)}
          {host ? ` on ${hostName(host)}` : ''}
          {plan.offline ? ', offline' : ''}
        </p>
      </header>
      <ol className="flex flex-col gap-2">
        {plan.steps.map((s, i) => {
          const stepState = states[i] ?? 'open';
          return (
            <li key={s.id} data-testid="plan-step" data-state={stepState} className="grid grid-cols-[1.5rem_1fr_auto] gap-2 items-start border-t border-rule pt-2">
              <span className="tabular text-ink-3 font-semibold">{s.id}</span>
              <div>
                <p>{s.text}</p>
                <p className="font-mono text-small text-ink-2 break-words">{[...s.files, ...(s.test ? [s.test] : [])].join(', ')}</p>
              </div>
              <StatusChip label={stepState} tone={stepState === 'done' ? 'active' : 'neutral'} />
            </li>
          );
        })}
      </ol>
      {plan.filesToTouch.length ? (
        <Section title="Files">
          <ul className="font-mono text-small flex flex-col gap-1" data-testid="plan-files">
            {plan.filesToTouch.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      {plan.risks.length ? (
        <Section title="Risks">
          <div data-testid="plan-risks">
            <List items={plan.risks.map((r) => `${r.id}: ${r.text}`)} empty="" />
          </div>
        </Section>
      ) : null}
      {plan.similarTasks.length ? (
        <Section title="Similar tasks">
          <p data-testid="plan-similar">{plan.similarTasks.join(', ')}</p>
        </Section>
      ) : null}
    </article>
  );
}
