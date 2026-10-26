import { type Handoff, type Plan, type Review, countTokens, renderHandoff } from '@stint-dev/core';
import { useState } from 'react';
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

export function HandoffCard({ handoff }: { handoff: Handoff | null }) {
  const [view, setView] = useState<'packet' | 'prompt' | 'json'>('packet');
  if (!handoff) return <EmptyState testId="empty-packet">The packet appears here when a run ends, however it ends.</EmptyState>;
  const prompt = renderHandoff(handoff);
  const bytes = new TextEncoder().encode(prompt).length;
  const from = agentOf(handoff.from.adapter, handoff.from.host);
  return (
    <article data-testid="handoff-card" className="flex flex-col gap-1 max-w-[72ch]">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-line">
        <div className="flex items-center gap-2">
          <VendorMark agent={from} />
          <span className="text-muted">
            {handoff.from.run}, {modelName(handoff.from.model)}
          </span>
          <StatusChip status={handoff.from.endedBy} />
        </div>
        <div className="flex items-center gap-3 text-[12px] text-muted tabular" data-testid="packet-size">
          <span>{countTokens(prompt)} tokens</span>
          <span>{(bytes / 1024).toFixed(1)} KB</span>
          <span className="font-mono text-faint" title={handoff.hash}>
            {handoff.hash.slice(7, 19)}
          </span>
        </div>
      </header>
      <div className="flex gap-1 pt-2" role="tablist" aria-label="Packet view">
        {(['packet', 'prompt', 'json'] as const).map((v) => (
          <Button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx('h-7', view === v && 'border-accent text-accent')}>
            {v === 'packet' ? 'Packet' : v === 'prompt' ? 'As prompt' : 'Raw JSON'}
          </Button>
        ))}
      </div>
      {view === 'prompt' ? (
        <pre className="font-mono text-[12px] leading-[18px] whitespace-pre-wrap bg-sunken rounded-md p-3 mt-2">{prompt}</pre>
      ) : view === 'json' ? (
        <pre className="font-mono text-[12px] leading-[18px] whitespace-pre-wrap bg-sunken rounded-md p-3 mt-2">{JSON.stringify(handoff, null, 2)}</pre>
      ) : (
        <>
          <Section title="Ask of next">
            <p data-testid="ask-of-next" className="rounded-md border border-accent/50 bg-accent-tint px-3 py-2 text-ink">
              {handoff.askOfNext}
            </p>
          </Section>
          <Section title="Where it got to">
            <p>{handoff.summary}</p>
          </Section>
          <Section title="Done">
            <List items={handoff.done} empty="Nothing recorded as done." />
          </Section>
          <Section title="Open">
            <List items={handoff.open} empty="Nothing open." />
          </Section>
          <Section title="Left out">
            <List items={handoff.leftOut} empty="The agent said it left nothing out." />
          </Section>
          <Section title="Refused actions">
            <List items={(handoff.refusals ?? []).map((r) => `${r.action} (${r.reason ?? r.by})`)} empty="No action was refused." />
          </Section>
          <Section title="Decisions">
            <List items={handoff.decisions.map((d) => `${d.id}: ${d.text}`)} empty="No decisions yet." />
          </Section>
          <Section title="Risks">
            <List items={handoff.risks} empty="No risks named." />
          </Section>
          <Section title="Changed files" aside={<CostMeter cost={handoff.cost} detail className="text-[12px] text-muted" />}>
            <ul className="font-mono text-[12px] flex flex-col gap-0.5">
              {handoff.changedFiles.map((f) => (
                <li key={f.path} className="flex gap-3">
                  <span className="truncate">{f.path}</span>
                  <span className="tabular text-good">+{f.added}</span>
                  <span className="tabular text-bad">-{f.removed}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </article>
  );
}

export function ReviewCard({ review }: { review: Review | null }) {
  if (!review) return <EmptyState testId="empty-review">The review appears here after a green verification.</EmptyState>;
  return (
    <article data-testid="review-card" className="flex flex-col gap-3 max-w-[72ch]">
      <header className="flex flex-wrap items-center gap-2">
        <StatusChip label={review.verdict.replace('_', ' ')} tone={review.verdict === 'approve' ? 'good' : review.verdict === 'block' ? 'bad' : 'warn'} />
        {review.offline ? <StatusChip label="offline" tone="neutral" /> : null}
        <span className="text-muted">
          {modelName(review.model)}, <CostMeter cost={review.cost} />
        </span>
      </header>
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
                  <code className="font-mono text-muted">
                    {f.file}
                    {f.line ? `:${f.line}` : ''}
                  </code>
                ) : null}
                {f.contradictsDecision ? <StatusChip label={`contradicts ${f.contradictsDecision}, routed to the queue`} tone="warn" /> : null}
              </div>
              <p className="mt-1">{f.text}</p>
            </li>
          ))}
        </ol>
      )}
      {review.summary && review.findings.length > 0 ? <p className="text-muted">{review.summary}</p> : null}
    </article>
  );
}

export function PlanCard({ plan }: { plan: Plan | null }) {
  if (!plan) return <EmptyState testId="empty-plan">The plan arrives here when the planner finishes.</EmptyState>;
  const [host, model] = plan.model.includes('/') ? plan.model.split('/') : [null, plan.model];
  return (
    <article data-testid="plan-card" className="flex flex-col gap-2 max-w-[72ch]">
      <p className="text-muted">
        Planned by {modelName(model)}
        {host ? ` on ${hostName(host)}` : ''}
        {plan.offline ? ', offline' : ''}
        {plan.similarTasks.length ? `. Similar past tasks: ${plan.similarTasks.join(', ')}` : ''}
      </p>
      <ol className="flex flex-col gap-2">
        {plan.steps.map((s) => (
          <li key={s.id} className="grid grid-cols-[1.5rem_1fr] gap-2">
            <span className="tabular text-faint">{s.id}</span>
            <div>
              <p>{s.text}</p>
              <p className="font-mono text-[12px] text-muted">{[...s.files, ...(s.test ? [s.test] : [])].join(', ')}</p>
            </div>
          </li>
        ))}
      </ol>
      {plan.risks.length ? (
        <Section title="Risks">
          <List items={plan.risks.map((r) => `${r.id}: ${r.text}`)} empty="" />
        </Section>
      ) : null}
    </article>
  );
}
