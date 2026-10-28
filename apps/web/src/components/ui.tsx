import type { Cost } from '@stint-dev/core';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { type Agent, carNumber, markColor } from '../agents';
import { money, tokens } from '../format';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** A driver: the team livery, the three-letter code, and the name in words. Colour lives only here, on stint bars and on team segments. */
export function VendorMark({ agent, showName = true, size = 14 }: { agent: Agent; showName?: boolean; size?: number }) {
  return (
    <span className={cx('inline-flex items-center gap-2 align-middle', showName ? 'min-w-0' : 'shrink-0')}>
      <span aria-hidden="true" className="inline-block shrink-0 rounded-[2px]" style={{ width: Math.max(6, Math.round(size * 0.55)), height: size, background: markColor[agent.mark] }} />
      <span className="font-extrabold stretch-75 tracking-[0.03em] leading-none" style={{ fontSize: Math.max(12, size - 1) }} aria-hidden="true">
        {agent.code}
      </span>
      {showName ? <span className="truncate text-ink-2">{agent.name}</span> : <span className="sr-only">{agent.name}</span>}
    </span>
  );
}

/** A car number plate. Solid on track and at the gate, dashed on the grid, outlined for a call with the stewards, dim once it took the flag. */
export function Plate({ id, size = 'md', variant = 'solid', className }: { id: string; size?: 'sm' | 'md' | 'lg' | 'xl'; variant?: 'solid' | 'grid' | 'outline' | 'dim'; className?: string }) {
  const box = { sm: 'min-w-8 h-6 text-[19px]', md: 'min-w-11 h-8 text-[28px]', lg: 'min-w-12 h-10 text-[34px]', xl: 'min-w-16 h-12 text-[34px]' }[size];
  return (
    <span
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center rounded-[4px] px-2 box-border font-black stretch-62 leading-none tabular',
        box,
        variant === 'solid' && 'bg-plate text-on-plate',
        variant === 'dim' && 'bg-plate text-on-plate opacity-70',
        variant === 'outline' && 'border-2 border-ink text-ink',
        variant === 'grid' && 'border-2 border-dashed border-ink-3 text-ink',
        className,
      )}
    >
      <span className="sr-only">Car </span>
      {carNumber(id)}
    </span>
  );
}

export type ChipTone = 'neutral' | 'active' | 'good' | 'warn' | 'bad' | 'merged' | 'learned';

/** Each tone is a race flag; its word always stands beside it, in the themed colour for the flag. */
const SWATCH: Record<ChipTone, string | null> = {
  neutral: 'var(--rule-strong)',
  active: 'var(--sw-green)',
  good: 'var(--sw-green)',
  warn: 'var(--sw-yellow)',
  bad: 'var(--sw-red)',
  merged: null,
  learned: 'var(--purple)',
};
const WORD: Record<ChipTone, string> = {
  neutral: 'text-ink-2',
  active: 'text-ink',
  good: 'text-green',
  warn: 'text-yellow',
  bad: 'text-red',
  merged: 'text-ink',
  learned: 'text-purple',
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
  done: { label: 'done', tone: 'merged' },
  abandoned: { label: 'abandoned', tone: 'neutral' },
  running: { label: 'running', tone: 'active' },
  completed: { label: 'finished', tone: 'good' },
  killed: { label: 'killed', tone: 'bad' },
  capped: { label: 'capped', tone: 'warn' },
  failed: { label: 'failed', tone: 'bad' },
  handed: { label: 'handed off', tone: 'active' },
  green: { label: 'green', tone: 'good' },
  red: { label: 'red', tone: 'bad' },
};

export function Swatch({ tone, className }: { tone: ChipTone; className?: string }) {
  const fill = SWATCH[tone];
  return <span aria-hidden="true" className={cx('sw', fill === null && 'chequer-sm', className)} style={fill ? { background: fill } : undefined} />;
}

/** A status as a flag with its word: the swatch never stands alone. */
export function StatusChip({ status, label, tone }: { status?: string; label?: string; tone?: ChipTone }) {
  const s = status ? STATUS[status] : undefined;
  const t = tone ?? s?.tone ?? 'neutral';
  return (
    <span data-status={status} className={cx('inline-flex items-center gap-2 h-5 text-[12px] font-bold leading-none whitespace-nowrap', WORD[t])}>
      <Swatch tone={t} />
      {/* sentence case on screen; the words stay as the daemon and the tests name them */}
      <span className="inline-block first-letter:uppercase">{label ?? s?.label ?? status}</span>
    </span>
  );
}

/** Money and tokens with tabular figures, so a live meter does not jitter. */
export function CostMeter({ cost, detail = false, className }: { cost: Cost | null | undefined; detail?: boolean; className?: string }) {
  if (!cost) return <span className={cx('tabular text-ink-3', className)}>no cost yet</span>;
  return (
    <span className={cx('tabular', className)} title={`${cost.inputTokens} input tokens (${cost.cachedTokens} cached), ${cost.outputTokens} output`}>
      {money(cost)}
      {detail ? (
        <span className="text-ink-3">
          {' '}
          {tokens(cost.inputTokens)} in, {tokens(cost.outputTokens)} out
        </span>
      ) : null}
    </span>
  );
}

export function EmptyState({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId ?? 'empty'} className="text-ink-2 max-w-[60ch] py-4 text-[14px]">
      {children}
    </p>
  );
}

type ButtonTone = 'primary' | 'quiet' | 'danger';
export function Button({ tone = 'quiet', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  // a height, padding or size the caller gives replaces the default; two utilities for one property would leave the
  // winner to the stylesheet's order, not to the caller
  const own = (re: RegExp) => re.test(className ?? '');
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[3px] whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        !own(/(^|\s)h-/) && 'h-8',
        !own(/(^|\s)px-/) && 'px-3',
        !own(/(^|\s)text-\[/) && 'text-[14px]',
        tone === 'primary' && 'bg-ink text-ground font-extrabold stretch-87 border border-ink hover:opacity-90 disabled:bg-panel-2 disabled:text-ink-2 disabled:border-panel-2',
        // a toggle shows its state through aria-pressed; a variant, so it wins over the base colours
        tone === 'quiet' && 'bg-transparent text-ink font-semibold border border-ink-3 hover:border-ink disabled:text-ink-3 disabled:border-rule aria-pressed:border-ink aria-pressed:bg-panel-2 aria-selected:border-ink aria-selected:bg-panel-2',
        tone === 'danger' && 'bg-transparent text-red font-semibold border border-ink-3 hover:border-red disabled:opacity-60',
        className,
      )}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid place-items-center min-w-4 h-4 px-1 font-mono text-[12px] font-medium leading-none opacity-75">{children}</kbd>;
}

/** A heading in the design's heading role, with an aside on the right. */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="py-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="text-[14px] font-bold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
