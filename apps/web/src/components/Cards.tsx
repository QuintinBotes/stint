import { type Handoff, type Plan, type Review, countTokens, renderHandoff } from '@stint-dev/core';
import { useState } from 'react';
import { JsonView, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { Link } from 'react-router';
import { type Agent, agentOf, hostName, modelName } from '../agents';
import { CostMeter, EmptyState, Section, StatusChip, VendorMark, cx } from './ui';

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-ink-3">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1 list-disc pl-4 marker:text-ink-3">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

/** Past the point where a card fills: what was never made is said as such, not promised for later. */
const SETTLED = new Set(['awaiting_approval', 'approved', 'done', 'rejected', 'abandoned', 'in_review']);

/** An empty card: the sentence for the car's state, and that state beside it. `settled` is said once the car is past it. */
function PlannedEmpty({ testId, status = 'planned', children, settled }: { testId: string; status?: string; children: string; settled: string }) {
  return (
    <div className="flex items-center gap-2">
      <StatusChip status={status} />
      <EmptyState testId={testId}>{SETTLED.has(status) ? settled : children}</EmptyState>
    </div>
  );
}

/** One row of the stop sheet: its name on the left, what the packet says on the right. */
function Row({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] sm:grid-cols-[96px_minmax(0,1fr)] gap-3 py-3 border-b border-rule text-[14px] leading-5">
      <span className="text-ink-2">{label}</span>
      <div className={cx('min-w-0', mono && 'font-mono text-[12px]')}>{children}</div>
    </div>
  );
}

/** Left-out items, with the step that was in flight when a run was killed called out first. */
function LeftOut({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-ink-3">The agent said it left nothing out.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((i) => {
        const inFlight = /^In-flight step unknown:\s*/.exec(i);
        return (
          <li key={i}>
            {inFlight ? (
              <>
                <span className="font-bold text-yellow">In-flight step unknown:</span> {i.slice(inFlight[0].length)}
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

const VIEWS = [
  ['packet', 'Stop sheet'],
  ['prompt', 'As the prompt'],
  ['json', 'Raw JSON'],
] as const;

/** The packet a run left: the pit board, then the stop sheet, the prompt the next driver reads, or the raw JSON. */
export function HandoffCard({ handoff, status }: { handoff: Handoff | null; status?: string }) {
  const [view, setView] = useState<'packet' | 'prompt' | 'json'>('packet');
  if (!handoff)
    return (
      <PlannedEmpty testId="empty-packet" status={status} settled="No run on this car left a packet.">
        The packet appears here when a run ends, however it ends.
      </PlannedEmpty>
    );
  const prompt = renderHandoff(handoff);
  const bytes = new TextEncoder().encode(prompt).length;
  const tokenCount = countTokens(prompt);
  const from = agentOf(handoff.from.adapter, handoff.from.host, handoff.from.model);
  // a packet for a planner or reviewer call names the role; there is no harness to name
  const to: Agent | null = handoff.to ? (handoff.to.adapter === 'openai-compatible' ? { name: `The ${handoff.to.role}`, mark: 'meta', code: handoff.to.role === 'reviewer' ? 'REV' : 'PLN' } : agentOf(handoff.to.adapter)) : null;
  const stopped = handoff.from.endedBy === 'killed' || handoff.from.endedBy === 'failed';
  const v = handoff.verification;
  return (
    <article data-testid="handoff-card" className="flex flex-col gap-4 max-w-[80ch]">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-[14px] leading-5 font-bold">
            Driver change: packet from {handoff.from.run}
            {to ? ` to ${to.name.replace(/^The /, 'the ')}` : ''}
          </h2>
          <StatusChip status={handoff.from.endedBy} />
        </div>
        <p className="text-[12px] text-ink-2 tabular" data-testid="packet-size">
          {tokenCount} tokens, {(bytes / 1024).toFixed(1)} KB.{' '}
          <span className="font-mono text-ink-3" title={handoff.hash}>
            {handoff.hash.slice(7, 19)}
          </span>
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-4 text-[14px]">
        <VendorMark agent={from} showName={false} size={24} />
        <span className={cx(stopped ? 'text-red font-bold' : 'text-ink-2')}>
          {from.name}, {handoff.from.endedBy} in {handoff.from.run}
          {handoff.from.model ? `, ${modelName(handoff.from.model)}` : ''}
        </span>
        <span aria-hidden="true" className="flex-1 min-w-6 border-t-2 border-dashed border-rule-strong" />
        <span className="text-ink-2">the packet</span>
        <span aria-hidden="true" className="flex-1 min-w-6 border-t-2 border-dashed border-rule-strong" />
        {to ? <VendorMark agent={to} showName={false} size={24} /> : null}
        <span className="text-ink-2">{to ? `${to.name}, ${handoff.to?.role ?? 'implementer'}` : 'whoever you send out, below'}</span>
      </div>
      <div className="flex gap-4" role="tablist" aria-label="Packet view">
        {VIEWS.map(([k, name]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={view === k}
            onClick={() => setView(k)}
            className={cx('pb-1 border-b-[3px] text-[14px] font-bold', view === k ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink')}
          >
            {name}
          </button>
        ))}
      </div>
      {view === 'prompt' ? (
        <pre className="font-mono text-[12px] leading-5 whitespace-pre-wrap rounded-[3px] bg-panel p-4">{prompt}</pre>
      ) : view === 'json' ? (
        <div data-testid="packet-json">
          <JsonView data={handoff} shouldExpandNode={(level) => level < 2} style={JSON_STYLE} />
        </div>
      ) : (
        <div className="flex flex-col border-t-2 border-ink">
          <Row label="Summary">
            <p>{handoff.summary}</p>
          </Row>
          <Row label="Done">
            <List items={handoff.done} empty="Nothing recorded as done." />
          </Row>
          <Row label="Open">
            <List items={handoff.open} empty="Nothing open." />
          </Row>
          <Row label="Left out">
            <LeftOut items={handoff.leftOut} />
          </Row>
          <Row label="Decisions">
            {handoff.decisions.length ? (
              <ul className="flex flex-col gap-1">
                {handoff.decisions.map((d) => (
                  <li key={d.id}>
                    <span className="font-mono text-[12px] text-ink-2 mr-2">{d.id}</span>
                    {d.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-3">No decisions yet.</p>
            )}
          </Row>
          <Row label="Risks">
            <List items={handoff.risks} empty="No risks named." />
            <p className="mt-1 text-ink-2">Refused actions: {(handoff.refusals ?? []).length ? (handoff.refusals ?? []).map((r) => `${r.action} (${r.reason ?? r.by})`).join('; ') : 'none'}</p>
          </Row>
          <Row label="Files" mono>
            {handoff.changedFiles.length ? (
              <ul className="flex flex-col gap-1">
                {handoff.changedFiles.map((f) => (
                  <li key={f.path} className="flex gap-3">
                    <span className="truncate">{f.path}</span>
                    <span className="tabular text-green">+{f.added}</span>
                    <span className="tabular text-red">-{f.removed}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-sans text-[12px] text-ink-3">No files changed in this run.</p>
            )}
          </Row>
          <Row label="Verify">
            {v ? `${v.status ?? (v.exitCode === 0 ? 'green' : 'red')}, ${v.passed} passed, ${v.failed} failed, run by the daemon` : stopped ? 'Not run. The run stopped before the daemon could verify.' : 'Not run yet.'}
          </Row>
          <Row label="Cost">
            <CostMeter cost={handoff.cost} detail />
          </Row>
          <Row label="Ask of next">
            <p data-testid="ask-of-next" className="font-bold text-ink">
              {handoff.askOfNext}
            </p>
          </Row>
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
  container: 'font-mono text-[12px] leading-5 bg-panel rounded-[3px] p-4 overflow-x-auto',
  label: 'text-ink-2 mr-1',
  clickableLabel: 'text-ink-2 mr-1 cursor-pointer',
  stringValue: 'text-green break-words',
  numberValue: 'text-yellow',
  booleanValue: 'text-yellow',
  nullValue: 'text-ink-3',
  undefinedValue: 'text-ink-3',
  otherValue: 'text-ink',
  punctuation: 'text-ink-3',
};

export function ReviewCard({ review, decisions = [], status }: { review: Review | null; decisions?: Array<{ id: string; text: string }>; status?: string }) {
  if (!review)
    return (
      <PlannedEmpty testId="empty-review" status={status} settled="No review was recorded on this car.">
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
        <ul className="flex flex-col gap-1 text-[12px]" data-testid="review-lenses">
          {review.lenses.map((l, i) => (
            <li key={`${l.lens}-${l.run ?? i}`} className="flex flex-wrap items-center gap-2" data-lens={l.lens}>
              <span className="font-bold w-[72px]">{LENS_NAMES[l.lens] ?? l.lens}</span>
              <StatusChip label={l.verdict.replace('_', ' ')} tone={l.verdict === 'approve' ? 'good' : l.verdict === 'block' ? 'bad' : 'warn'} />
              <span className="text-ink-2">
                {modelName(l.model)}, {l.findings} finding{l.findings === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {review.disagreement ? (
        <p data-testid="review-disagreement" className="text-[14px] text-yellow">
          The reviewers did not agree on the verdict. The strictest one counts; read their findings before you approve.
        </p>
      ) : null}
      {review.blockers.length ? (
        <section data-testid="review-blockers" aria-label="Blockers">
          <h3 className="text-[14px] font-bold stretch-112 text-red">
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
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="font-mono font-bold">{f.id}</span>
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
                <p className="mt-2 border-l-2 border-yellow pl-2 text-ink-2" data-testid="contradicted-decision">
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
      <PlannedEmpty testId="empty-plan" status={status} settled="No plan was made for this car.">
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
              <span className="tabular text-ink-3 font-extrabold stretch-75 text-[14px]">{s.id}</span>
              <div>
                <p>{s.text}</p>
                <p className="font-mono text-[12px] text-ink-2">{[...s.files, ...(s.test ? [s.test] : [])].join(', ')}</p>
              </div>
              <StatusChip label={stepState} tone={stepState === 'done' ? 'good' : 'neutral'} />
            </li>
          );
        })}
      </ol>
      {plan.filesToTouch.length ? (
        <Section title="Files">
          <ul className="font-mono text-[12px] flex flex-col gap-1" data-testid="plan-files">
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
