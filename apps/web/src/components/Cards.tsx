import { type Handoff, type Plan, type Review, countTokens, renderHandoff } from '@stint-dev/core';
import { useState } from 'react';
import { JsonView, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { Link } from 'react-router';
import { agentOf, hostName, modelName } from '../agents';
import { Button, CostMeter, EmptyState, Section, StatusChip, VendorMark, cx } from './ui';

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-faint">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1 list-disc pl-4 marker:text-faint">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

/** An empty card: its sentence, and the state the task is waiting in beside it. */
function PlannedEmpty({ testId, children }: { testId: string; children: string }) {
  return (
    <div className="flex items-center gap-2">
      <StatusChip status="planned" />
      <EmptyState testId={testId}>{children}</EmptyState>
    </div>
  );
}

/** One cell of the packet grid: a small label over its content. */
function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('p-3 min-w-0', className)}>
      <p className="text-[12px] text-muted mb-1">{label}</p>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

/** Left-out items, with the step that was in flight when a run was killed called out first. */
function LeftOut({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-faint">The agent said it left nothing out.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((i) => {
        const inFlight = /^In-flight step unknown:\s*/.exec(i);
        return (
          <li key={i}>
            {inFlight ? (
              <>
                <span className="font-semibold text-warn">In-flight step unknown:</span> {i.slice(inFlight[0].length)}
              </>
            ) : (
              i
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function HandoffCard({ handoff }: { handoff: Handoff | null }) {
  const [view, setView] = useState<'packet' | 'prompt' | 'json'>('packet');
  if (!handoff) return <PlannedEmpty testId="empty-packet">The packet appears here when a run ends, however it ends.</PlannedEmpty>;
  const prompt = renderHandoff(handoff);
  const bytes = new TextEncoder().encode(prompt).length;
  const from = agentOf(handoff.from.adapter, handoff.from.host, handoff.from.model);
  // a packet for a planner or reviewer call names the role; there is no harness to name
  const to = handoff.to ? (handoff.to.adapter === 'openai-compatible' ? { name: `The ${handoff.to.role}`, mark: 'meta' as const, letter: handoff.to.role === 'reviewer' ? 'RV' : 'PL' } : agentOf(handoff.to.adapter)) : null;
  return (
    <article data-testid="handoff-card" className="flex flex-col gap-3 max-w-[80ch]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
              Packet from {handoff.from.run}
              {to ? ` to ${to.name.replace(/^The /, 'the ')}` : ''}
            </h2>
            <StatusChip status={handoff.from.endedBy} />
          </div>
          <p className="text-[12px] text-muted tabular" data-testid="packet-size">
            {countTokens(prompt)} tokens, {(bytes / 1024).toFixed(1)} KB.{' '}
            <span className="font-mono text-faint" title={handoff.hash}>
              {handoff.hash.slice(7, 19)}
            </span>
          </p>
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Packet view">
          {(['packet', 'prompt', 'json'] as const).map((v) => (
            <Button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className="h-7">
              {v === 'packet' ? 'Packet' : v === 'prompt' ? 'As prompt' : 'Raw JSON'}
            </Button>
          ))}
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 min-w-[200px]">
          <VendorMark agent={from} showName={false} size={22} />
          <div className="leading-tight">
            <p className="text-[13px] font-medium">{from.name}</p>
            <p className={cx('text-[12px]', handoff.from.endedBy === 'killed' || handoff.from.endedBy === 'failed' ? 'text-warn' : 'text-muted')}>
              {handoff.from.run}, ended by {handoff.from.endedBy}
              {handoff.from.model ? `, ${modelName(handoff.from.model)}` : ''}
            </p>
          </div>
        </div>
        <span aria-hidden className="text-faint">→</span>
        <div className={cx('flex items-center gap-2 rounded-lg border px-3 py-2 min-w-[200px]', to ? 'border-accent/60 bg-accent-tint' : 'border-dashed border-line')}>
          {to ? <VendorMark agent={to} showName={false} size={22} /> : null}
          <div className="leading-tight">
            <p className="text-[13px] font-medium">{to ? to.name : 'The next agent'}</p>
            <p className="text-[12px] text-muted">{to ? `${handoff.to?.role ?? 'implementer'}, reads this packet` : 'whoever you hand it to, below'}</p>
          </div>
        </div>
      </div>
      {view === 'prompt' ? (
        <pre className="font-mono text-[12px] leading-[18px] whitespace-pre-wrap bg-sunken rounded-md p-3">{prompt}</pre>
      ) : view === 'json' ? (
        <div data-testid="packet-json">
          <JsonView data={handoff} shouldExpandNode={(level) => level < 2} style={JSON_STYLE} />
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-raised divide-y divide-line">
          <Cell label="Summary">
            <p>{handoff.summary}</p>
          </Cell>
          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line">
            <Cell label="Done">
              <List items={handoff.done} empty="Nothing recorded as done." />
            </Cell>
            <Cell label="Open">
              <List items={handoff.open} empty="Nothing open." />
            </Cell>
          </div>
          <Cell label="Left out">
            <LeftOut items={handoff.leftOut} />
          </Cell>
          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line">
            <Cell label="Decisions">
              {handoff.decisions.length ? (
                <ul className="flex flex-col gap-1">
                  {handoff.decisions.map((d) => (
                    <li key={d.id}>
                      <span className="font-mono text-muted mr-1.5">{d.id}</span>
                      {d.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-faint">No decisions yet.</p>
              )}
            </Cell>
            <Cell label="Risks">
              <List items={handoff.risks} empty="No risks named." />
              <p className="mt-1 text-[12px] text-muted">Refused actions: {(handoff.refusals ?? []).length ? (handoff.refusals ?? []).map((r) => `${r.action} (${r.reason ?? r.by})`).join('; ') : 'none'}</p>
            </Cell>
          </div>
          <Cell label="Changed files">
            {handoff.changedFiles.length ? (
              <ul className="font-mono text-[12px] flex flex-col gap-0.5">
                {handoff.changedFiles.map((f) => (
                  <li key={f.path} className="flex gap-3">
                    <span className="truncate">{f.path}</span>
                    <span className="tabular text-good">+{f.added}</span>
                    <span className="tabular text-bad">-{f.removed}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-faint">No files changed in this run.</p>
            )}
          </Cell>
          <div className="p-3">
            <div className="rounded-md border border-accent/50 bg-accent-tint px-3 py-2.5">
              <p className="text-[12px] font-semibold mb-1">Ask of next</p>
              <p data-testid="ask-of-next" className="text-ink">
                {handoff.askOfNext}
              </p>
            </div>
            <p className="mt-2 text-[12px] text-muted">
              Run cost: <CostMeter cost={handoff.cost} detail className="text-[12px] text-muted" />
            </p>
          </div>
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
  container: 'font-mono text-[12px] leading-[18px] bg-sunken rounded-md p-3 overflow-x-auto',
  label: 'text-muted mr-1',
  clickableLabel: 'text-muted mr-1 cursor-pointer',
  stringValue: 'text-good break-words',
  numberValue: 'text-accent',
  booleanValue: 'text-warn',
  nullValue: 'text-faint',
  undefinedValue: 'text-faint',
  otherValue: 'text-ink',
  punctuation: 'text-faint',
};

export function ReviewCard({ review, decisions = [] }: { review: Review | null; decisions?: Array<{ id: string; text: string }> }) {
  if (!review) return <PlannedEmpty testId="empty-review">The review appears here after a green verification.</PlannedEmpty>;
  return (
    <article data-testid="review-card" className="flex flex-col gap-3 max-w-[72ch]">
      <header className="flex flex-wrap items-center gap-2">
        <StatusChip label={review.verdict.replace('_', ' ')} tone={review.verdict === 'approve' ? 'good' : review.verdict === 'block' ? 'bad' : 'warn'} />
        {review.offline ? <StatusChip label="offline" tone="neutral" /> : null}
        <span className="text-muted">
          {review.lens === 'combined' ? 'combined from the reviews below' : modelName(review.model)}
          {review.cost ? (
            <>
              , <CostMeter cost={review.cost} />
            </>
          ) : null}
        </span>
      </header>
      {review.lenses?.length ? (
        <ul className="flex flex-col gap-1 text-[12px]" data-testid="review-lenses">
          {review.lenses.map((l, i) => (
            <li key={`${l.lens}-${l.run ?? i}`} className="flex flex-wrap items-center gap-2" data-lens={l.lens}>
              <span className="font-medium w-[72px]">{LENS_NAMES[l.lens] ?? l.lens}</span>
              <StatusChip label={l.verdict.replace('_', ' ')} tone={l.verdict === 'approve' ? 'good' : l.verdict === 'block' ? 'bad' : 'warn'} />
              <span className="text-muted">
                {modelName(l.model)}, {l.findings} finding{l.findings === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {review.disagreement ? (
        <p data-testid="review-disagreement" className="text-[12px] text-warn">
          The reviewers did not agree on the verdict. The strictest one counts; read their findings before you approve.
        </p>
      ) : null}
      {review.blockers.length ? (
        <section data-testid="review-blockers" aria-label="Blockers">
          <h3 className="text-[13px] font-semibold text-bad">
            {review.blockers.length} blocker{review.blockers.length === 1 ? '' : 's'}
          </h3>
          <ul className="mt-1 flex flex-col gap-1 list-disc pl-4 marker:text-bad">
            {review.blockers.map((b) => (
              <li key={b} className="text-bad">
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
            <li key={f.id} data-testid="finding" className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="font-semibold">{f.id}</span>
                <StatusChip label={f.severity} tone={f.severity === 'blocker' ? 'bad' : f.severity === 'major' ? 'warn' : 'neutral'} />
                {f.file ? (
                  <Link to={`?tab=diff&file=${encodeURIComponent(f.file)}`} className="font-mono text-muted hover:text-accent" data-testid="finding-file">
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
                {f.agreement && f.agreement > 1 ? <span className="text-muted">found by {f.agreement} reviewers</span> : null}
              </div>
              <p className="mt-1">{f.text}</p>
              {f.contradictsDecision ? (
                <p className="mt-2 border-l-2 border-warn pl-2 text-muted" data-testid="contradicted-decision">
                  {f.contradictsDecision}: {decisions.find((d) => d.id === f.contradictsDecision)?.text ?? 'not found in this task\'s decisions'}. The decision stands until you settle it in the queue.
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {review.summary && review.findings.length > 0 ? <p className="text-muted">{review.summary}</p> : null}
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

export function PlanCard({ plan, handoff }: { plan: Plan | null; handoff?: Handoff | null }) {
  if (!plan) return <PlannedEmpty testId="empty-plan">The plan arrives here when the planner finishes.</PlannedEmpty>;
  const [host, model] = plan.model.includes('/') ? plan.model.split('/') : [null, plan.model];
  const states = planStepStates(plan, handoff);
  const doneCount = states.filter((s) => s === 'done').length;
  const state = doneCount === plan.steps.length ? 'done' : doneCount > 0 ? 'building' : 'planned';
  return (
    <article data-testid="plan-card" className="flex flex-col gap-2 max-w-[72ch]">
      <header className="flex flex-wrap items-center gap-2">
        <StatusChip status={state} />
        <p className="text-muted">
          Planned by {modelName(model)}
          {host ? ` on ${hostName(host)}` : ''}
          {plan.offline ? ', offline' : ''}
        </p>
      </header>
      <ol className="flex flex-col gap-2">
        {plan.steps.map((s, i) => {
          const stepState = states[i] ?? 'open';
          return (
            <li key={s.id} data-testid="plan-step" data-state={stepState} className="grid grid-cols-[1.5rem_1fr_auto] gap-2 items-start">
              <span className="tabular text-faint">{s.id}</span>
              <div>
                <p>{s.text}</p>
                <p className="font-mono text-[12px] text-muted">{[...s.files, ...(s.test ? [s.test] : [])].join(', ')}</p>
              </div>
              <StatusChip label={stepState} tone={stepState === 'done' ? 'good' : 'neutral'} />
            </li>
          );
        })}
      </ol>
      {plan.filesToTouch.length ? (
        <Section title="Files">
          <ul className="font-mono text-[12px] flex flex-col gap-0.5" data-testid="plan-files">
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
