import { type Handoff, type Plan, type Review, countTokens, renderHandoff } from '@stint-dev/core';
import { useId, useState } from 'react';
import { JsonView, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { Link } from 'react-router';
import { agentOf, hostName, modelName } from '../agents';
import { type ChipTone, CostMeter, EmptyState, Explain, Section, StateMark, StatusChip, Who, cx, rev, tabClass, tabKeys } from './ui';

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

/** One field of the packet: its heading, then what the packet says. */
function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-3 border-t border-rule first:border-t-0 first:pt-0 text-small">
      <h3 className="text-body font-semibold mb-1.5">{title}</h3>
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
  ['packet', 'Summary'],
  ['prompt', 'As the agent reads it'],
  ['json', 'Raw JSON'],
] as const;

/** A packet addressed to a role, not a harness: said as the role, with no vendor ink, since no name goes with it. */
const ROLE_TO: Record<string, string> = { planner: 'The planner', reviewer: 'The reviewer', implementer: 'The next agent' };

/** A secondary part of a card, behind a native disclosure. */
const summaryClass = 'w-fit min-h-6 cursor-pointer font-semibold text-ink hover:underline underline-offset-4';

/** The packet a run left: its title-block table, then what was done, what is left and what is unsure; the prompt the next agent reads, or the raw JSON. */
export function HandoffCard({ handoff, status, name }: { handoff: Handoff | null; status?: string; name?: string | null }) {
  const [view, setView] = useState<'packet' | 'prompt' | 'json'>('packet');
  const id = useId();
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
  const to = handoff.to;
  const stopped = handoff.from.endedBy === 'killed' || handoff.from.endedBy === 'failed';
  const v = handoff.verification;
  const refusals = handoff.refusals ?? [];
  const th = cx('w-[34%]', rev.th);
  const td = rev.td;
  return (
    <article data-testid="handoff-card" className="flex flex-col gap-4 max-w-[760px]">
      <div className="flex flex-col gap-1">
        <h2 className="text-section">
          <span className="font-mono font-normal text-ink-3 mr-2.5">{handoff.task}</span>
          Packet {name ?? handoff.from.run}
        </h2>
        <Explain word="packet" />
      </div>
      <table className={rev.block}>
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
            <td className={td}>
              {!to ? (
                <span className="text-ink-2">The next agent you choose</span>
              ) : to.adapter === 'openai-compatible' ? (
                <span className="font-semibold">{ROLE_TO[to.role] ?? to.role}</span>
              ) : (
                <Who agent={agentOf(to.adapter)} className="font-semibold" />
              )}
            </td>
          </tr>
          <tr>
            <th scope="row" className={th}>
              Ended by
            </th>
            <td className={cx(td, stopped && 'text-red')}>
              <StatusChip status={handoff.from.endedBy} />
              {stopped ? " Built by Stint from what the run recorded and the files it changed, since a stopped agent cannot write it." : null}
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
        </tbody>
      </table>
      <div className="flex flex-wrap border-b border-rule" role="tablist" aria-label="Packet view" onKeyDown={tabKeys}>
        {VIEWS.map(([k, label]) => (
          <button
            key={k}
            id={`${id}-${k}`}
            type="button"
            role="tab"
            aria-selected={view === k}
            aria-controls={`${id}-panel`}
            tabIndex={view === k ? 0 : -1}
            onClick={() => setView(k)}
            className={tabClass(view === k)}
          >
            {label}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${view}`} className="min-w-0">
        {view === 'prompt' ? (
          <pre tabIndex={0} className="font-mono text-code whitespace-pre-wrap break-words rounded-[5px] bg-term text-term-ink px-4 py-3.5">
            {prompt}
          </pre>
        ) : view === 'json' ? (
          <div data-testid="packet-json">
            <JsonView data={handoff} shouldExpandNode={(level) => level < 2} style={JSON_STYLE} />
          </div>
        ) : (
          <div className="flex flex-col">
            <Field title="Where it got to">
              <p>{handoff.summary}</p>
            </Field>
            <Field title="Done">
              <List items={handoff.done} empty="Nothing recorded as done." />
            </Field>
            <Field title="Left to do">
              <List items={handoff.open} empty="Nothing left to do." />
            </Field>
            <Field title="Left out">
              <LeftOut items={handoff.leftOut} />
            </Field>
            <Field title="Risks">
              <List items={handoff.risks} empty="No risks named." />
            </Field>
            <section className="my-3 rounded-[5px] border border-rule bg-panel px-4 py-3">
              <h3 className="font-semibold mb-1">Ask of the next agent</h3>
              <p data-testid="ask-of-next">{handoff.askOfNext}</p>
            </section>
            <details className="pt-3 border-t border-rule text-small">
              <summary className={summaryClass}>Decisions, files, tests and cost</summary>
              <dl className="mt-2 grid grid-cols-1 gap-y-1 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-3 [&>dd]:mb-2 sm:[&>dd]:mb-0">
                <dt className="text-ink-2">Decisions</dt>
                <dd>
                  {handoff.decisions.length ? (
                    <ul className="flex flex-col gap-1">
                      {handoff.decisions.map((d) => (
                        <li key={d.id}>
                          {d.text} <span className="font-mono text-ink-3">{d.id}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-ink-3">None yet.</span>
                  )}
                </dd>
                <dt className="text-ink-2">Files changed</dt>
                <dd>
                  {handoff.changedFiles.length ? (
                    <ul className="flex flex-col gap-1 font-mono">
                      {handoff.changedFiles.map((f) => (
                        <li key={f.path} className="flex gap-3 min-w-0">
                          <span className="truncate">{f.path}</span>
                          <span className="tabular text-ink-2 shrink-0">
                            <span className="sr-only">{`${f.added} lines added, ${f.removed} removed`}</span>
                            <span aria-hidden="true">
                              +{f.added} -{f.removed}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-ink-3">No files changed in this run.</span>
                  )}
                </dd>
                <dt className="text-ink-2">Tests</dt>
                <dd className={cx(!v && 'text-ink-2')}>
                  {v
                    ? `${v.passed} passed, ${v.failed} failed, run by Stint.`
                    : stopped
                      ? 'Not run: the run stopped before Stint could test it.'
                      : 'Not run yet.'}
                </dd>
                <dt className="text-ink-2">Cost so far</dt>
                <dd>
                  <CostMeter cost={handoff.cost} detail />
                </dd>
                <dt className="text-ink-2">Refused actions</dt>
                <dd className="text-ink-2">{refusals.length ? refusals.map((r) => `${r.action} (${r.reason ?? r.by})`).join('; ') : 'None.'}</dd>
                <dt className="text-ink-2">Hash</dt>
                <dd className="font-mono break-all" title={handoff.hash}>
                  {handoff.hash.slice(0, 15)}…{handoff.hash.slice(-4)}
                </dd>
              </dl>
            </details>
          </div>
        )}
      </div>
    </article>
  );
}

const LENS_NAMES: Record<string, string> = { general: 'General', security: 'Security', 'spec-fit': 'Spec fit' };

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

/** A verdict is the reviewer's recommendation, not a state: approve and request changes are an ink outline with no shape, block is red with a cross. */
const VERDICT: Record<string, { label: string; tone: ChipTone }> = {
  approve: { label: 'approve', tone: 'recommend' },
  request_changes: { label: 'request changes', tone: 'recommend' },
  block: { label: 'block', tone: 'bad' },
};
const Verdict = ({ verdict }: { verdict: string }) => <StatusChip label={VERDICT[verdict]?.label ?? verdict.replace('_', ' ')} tone={VERDICT[verdict]?.tone ?? 'recommend'} />;

/** How serious a finding is, in words; only a blocker takes red and a shape, a major one an ink outline. */
const SEVERITY_TONE: Record<string, ChipTone> = { blocker: 'bad', major: 'recommend' };

/** `decisions` are the task's recorded decisions, so a finding that would reverse one shows what it would reverse. */
export function ReviewCard({ review, decisions = [], status }: { review: Review | null; decisions?: Array<{ id: string; text: string }>; status?: string }) {
  if (!review)
    return (
      <PlannedEmpty testId="empty-review" status={status} settled="No review was recorded on this task.">
        The review appears here after the tests pass.
      </PlannedEmpty>
    );
  return (
    <article data-testid="review-card" className="flex flex-col gap-3 max-w-[72ch]">
      <header className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2">Recommends</span>
          <Verdict verdict={review.verdict} />
          {review.offline ? <StatusChip label="on this machine" tone="neutral" /> : null}
          <span className="text-ink-2">
            {review.lens === 'combined' ? 'combined from the reviews below' : modelName(review.model)}
            {review.cost ? (
              <>
                , <CostMeter cost={review.cost} />
              </>
            ) : null}
          </span>
        </p>
        <Explain word="review" />
      </header>
      {review.lenses?.length ? (
        <ul className="flex flex-col gap-1 text-small" data-testid="review-lenses">
          {review.lenses.map((l, i) => (
            <li key={`${l.lens}-${l.run ?? i}`} className="flex flex-wrap items-center gap-2" data-lens={l.lens}>
              <span className="font-semibold w-[72px]">{LENS_NAMES[l.lens] ?? l.lens}</span>
              <Verdict verdict={l.verdict} />
              <span className="text-ink-2">
                {modelName(l.model)}, {l.findings} finding{l.findings === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {review.disagreement ? (
        <p data-testid="review-disagreement">The reviewers did not agree. The strictest verdict counts; read the findings before you approve.</p>
      ) : null}
      {review.blockers.length ? (
        <section data-testid="review-blockers" aria-label="Blockers">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-red">
            <StateMark shape="failed" />
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
        <p data-testid="no-findings">The review found no problems to fix.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {review.findings.map((f) => {
            const decision = f.contradictsDecision ? decisions.find((d) => d.id === f.contradictsDecision) : undefined;
            return (
              <li key={f.id} data-testid="finding" className="border-t border-rule pt-3 pb-1">
                <div className="flex flex-wrap items-center gap-2 text-small">
                  <StatusChip label={f.severity} tone={SEVERITY_TONE[f.severity] ?? 'neutral'} />
                  {f.file ? (
                    <Link to={`?tab=diff&file=${encodeURIComponent(f.file)}`} className="font-mono text-ink-2 underline underline-offset-2 decoration-ink-3 hover:text-ink" data-testid="finding-file">
                      {f.file}
                      {f.line ? `:${f.line}` : ''}
                    </Link>
                  ) : null}
                  {review.lens === 'combined' && f.lens ? <StatusChip label={LENS_NAMES[f.lens] ?? f.lens} tone="neutral" /> : null}
                  {f.agreement && f.agreement > 1 ? <span className="text-ink-2">found by {f.agreement} reviewers</span> : null}
                  <span className="ml-auto font-mono text-ink-3">{f.id}</span>
                </div>
                <p className="mt-1">{f.text}</p>
                {f.contradictsDecision ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[5px] border border-rule bg-panel px-3 py-2 text-small" data-testid="contradicted-decision">
                    <p className="min-w-0 flex-1 basis-[32ch]">
                      Would reverse decision {f.contradictsDecision}: {decision?.text ?? "not found in this task's decisions"}. The decision stands until you settle it.
                    </p>
                    <Link to="/factory" className="rounded-sm" data-testid="finding-queue">
                      <StatusChip label="Settle it in the queue" tone="warn" />
                    </Link>
                  </div>
                ) : null}
              </li>
            );
          })}
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
  const where = host ? hostName(host) : null;
  const states = planStepStates(plan, handoff);
  const doneCount = states.filter((s) => s === 'done').length;
  const state = doneCount === plan.steps.length ? 'done' : doneCount > 0 ? 'building' : 'planned';
  return (
    <article data-testid="plan-card" className="flex flex-col gap-2 max-w-[72ch]">
      <header className="flex flex-wrap items-center gap-2">
        <StatusChip status={state} />
        <p className="text-ink-2">
          Planned by {modelName(model)}
          {where ? ` on ${where}` : ''}
          {plan.offline && !where?.includes('this machine') ? ', on this machine' : ''}
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
                <p className="font-mono text-small text-ink-2 break-words">{[...new Set([...s.files, ...(s.test ? [s.test] : [])])].join(', ')}</p>
              </div>
              <StatusChip label={stepState === 'done' ? 'done' : 'to do'} tone={stepState === 'done' ? 'active' : 'neutral'} shape={stepState === 'done' ? 'closed' : 'waiting'} />
            </li>
          );
        })}
      </ol>
      {plan.risks.length ? (
        <Section title="Risks">
          <div data-testid="plan-risks">
            <List items={plan.risks.map((r) => `${r.text} (${r.id})`)} empty="" />
          </div>
        </Section>
      ) : null}
      {plan.similarTasks.length ? (
        <Section title="Similar past tasks">
          <p data-testid="plan-similar">{plan.similarTasks.join(', ')}</p>
        </Section>
      ) : null}
      {plan.filesToTouch.length ? (
        <details className="py-3">
          <summary className={summaryClass}>
            All {plan.filesToTouch.length} file{plan.filesToTouch.length === 1 ? '' : 's'} the plan touches
          </summary>
          <ul className="mt-2 font-mono text-small flex flex-col gap-1" data-testid="plan-files">
            {plan.filesToTouch.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
