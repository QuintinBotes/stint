import type { Cost } from '@stint-dev/core';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { type Agent, markColor } from '../agents';
import { money, tokens } from '../format';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** The agent's mark: a coloured square with a letter, and its name in words. Colour lives only here and on the rail. */
export function VendorMark({ agent, showName = true, size = 18 }: { agent: Agent; showName?: boolean; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span
        aria-hidden
        className="inline-grid place-items-center shrink-0 rounded-sm font-mono text-[9px] font-semibold leading-none tracking-tight"
        style={{ minWidth: size, height: size, padding: '0 2px', background: markColor[agent.mark], color: 'var(--on-mark)' }}
      >
        {agent.letter}
      </span>
      {showName ? <span className="truncate">{agent.name}</span> : <span className="sr-only">{agent.name}</span>}
    </span>
  );
}

export type ChipTone = 'neutral' | 'active' | 'good' | 'warn' | 'bad';

const TONE: Record<ChipTone, string> = {
  neutral: 'border-line text-muted bg-sunken',
  active: 'border-accent/40 text-accent bg-accent-tint',
  good: 'border-good/40 text-good bg-good-tint',
  warn: 'border-warn/40 text-warn bg-warn-tint',
  bad: 'border-bad/40 text-bad bg-bad-tint',
};

const STATUS: Record<string, { label: string; tone: ChipTone }> = {
  planned: { label: 'planned', tone: 'neutral' },
  building: { label: 'building', tone: 'active' },
  verifying: { label: 'verifying', tone: 'active' },
  reviewing: { label: 'reviewing', tone: 'active' },
  in_review: { label: 'in review', tone: 'active' },
  awaiting_approval: { label: 'needs you', tone: 'warn' },
  approved: { label: 'approved', tone: 'good' },
  rejected: { label: 'rejected', tone: 'bad' },
  done: { label: 'done', tone: 'good' },
  abandoned: { label: 'abandoned', tone: 'neutral' },
  running: { label: 'running', tone: 'active' },
  completed: { label: 'finished', tone: 'good' },
  killed: { label: 'killed', tone: 'warn' },
  capped: { label: 'capped', tone: 'warn' },
  failed: { label: 'failed', tone: 'bad' },
  handed: { label: 'handed off', tone: 'active' },
  green: { label: 'green', tone: 'good' },
  red: { label: 'red', tone: 'bad' },
};

export function StatusChip({ status, label, tone }: { status?: string; label?: string; tone?: ChipTone }) {
  const s = status ? STATUS[status] : undefined;
  return (
    <span
      data-status={status}
      className={cx('inline-flex items-center rounded-full border px-2 h-5 text-[11px] font-medium leading-none whitespace-nowrap', TONE[tone ?? s?.tone ?? 'neutral'])}
    >
      {label ?? s?.label ?? status}
    </span>
  );
}

/** Money and tokens with tabular figures, so a live meter does not jitter. */
export function CostMeter({ cost, detail = false, className }: { cost: Cost | null | undefined; detail?: boolean; className?: string }) {
  if (!cost) return <span className={cx('tabular text-faint', className)}>no cost yet</span>;
  return (
    <span className={cx('tabular', className)} title={`${cost.inputTokens} input tokens (${cost.cachedTokens} cached), ${cost.outputTokens} output`}>
      {money(cost)}
      {detail ? (
        <span className="text-faint">
          {' '}
          {tokens(cost.inputTokens)} in, {tokens(cost.outputTokens)} out
        </span>
      ) : null}
    </span>
  );
}

export function EmptyState({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId ?? 'empty'} className="text-faint max-w-[44ch] py-6">
      {children}
    </p>
  );
}

type ButtonTone = 'primary' | 'quiet' | 'danger';
export function Button({ tone = 'quiet', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 h-8 px-3 rounded-md border text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        tone === 'primary' && 'bg-accent text-on-accent border-accent hover:opacity-90',
        // a toggle shows its state through aria-pressed; a variant, so it wins over the base colours
        tone === 'quiet' && 'bg-raised text-ink border-line hover:border-line-strong aria-pressed:border-accent aria-pressed:text-accent aria-pressed:bg-accent-tint',
        tone === 'danger' && 'bg-raised text-bad border-line hover:border-bad',
        className,
      )}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid place-items-center min-w-5 h-5 px-1 rounded-sm border border-line bg-sunken font-mono text-[11px] text-muted">{children}</kbd>;
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="py-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
