import type { Cost } from '@stint-dev/core';
import type { ComponentProps, ReactNode } from 'react';
import { type Agent, markColor } from '../agents';
import { money, tokens } from '../format';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Who did the work: the vendor's ink square and the agent or model name, always together. `live` breathes the square while a run is going; the caller sets the weight. */
export function Who({ agent, live = false, className }: { agent: Agent; live?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 min-w-0 whitespace-nowrap', className)}>
      <span aria-hidden="true" className={cx('size-2.5 shrink-0 rounded-[2px]', live && 'live-spine')} style={{ background: markColor[agent.mark] }} />
      <span className="truncate">{agent.name}</span>
    </span>
  );
}

export type ChipTone = 'neutral' | 'active' | 'good' | 'warn' | 'bad' | 'merged' | 'learned' | 'recommend';

/** A chip's wash and ink: amber needs you, green verified or merged, red stopped, violet learned; a recommendation is an ink outline, not a state. */
const CHIP: Record<ChipTone, string> = {
  neutral: 'bg-panel-2 text-ink-2',
  active: 'bg-panel-2 text-ink',
  good: 'bg-green-wash text-green',
  warn: 'bg-amber-wash text-amber',
  bad: 'bg-red-wash text-red',
  merged: 'bg-green-wash text-green',
  learned: 'bg-violet-wash text-violet',
  recommend: 'bg-transparent text-ink shadow-[inset_0_0_0_1px_var(--ink)]',
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
  completed: { label: 'finished', tone: 'neutral' },
  killed: { label: 'killed', tone: 'bad' },
  capped: { label: 'capped', tone: 'warn' },
  failed: { label: 'failed', tone: 'bad' },
  handed: { label: 'handed off', tone: 'active' },
  green: { label: 'green', tone: 'good' },
  red: { label: 'red', tone: 'bad' },
};

/** A status as a chip: its word on the state's wash. */
export function StatusChip({ status, label, tone }: { status?: string; label?: string; tone?: ChipTone }) {
  const s = status ? STATUS[status] : undefined;
  const t = tone ?? s?.tone ?? 'neutral';
  return (
    <span data-status={status} className={cx('inline-flex items-center h-6 px-2 rounded-[3px] text-small font-medium whitespace-nowrap', CHIP[t])}>
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
    <p data-testid={testId ?? 'empty'} className="text-ink-2 max-w-[60ch] py-4 text-body">
      {children}
    </p>
  );
}

type ButtonTone = 'primary' | 'quiet' | 'danger';
export function Button({ tone = 'quiet', className, ...rest }: ComponentProps<'button'> & { tone?: ButtonTone }) {
  // a height, padding or size the caller gives replaces the default; two utilities for one property would leave the
  // winner to the stylesheet's order, not to the caller
  const own = (re: RegExp) => re.test(className ?? '');
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[5px] border whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-ink-3 disabled:border-rule',
        !own(/(^|\s)h-/) && 'h-9',
        !own(/(^|\s)px-/) && 'px-3.5',
        !own(/(^|\s)text-(\[|title|section|body|small|code)/) && 'text-body',
        tone === 'primary' && 'bg-ink text-on-ink font-semibold border-ink hover:bg-ink-2 hover:border-ink-2',
        // a toggle shows its state through aria-pressed; a variant, so it wins over the base colours
        tone === 'quiet' && 'bg-transparent text-ink font-medium border-rule-strong hover:border-ink-2 hover:bg-panel aria-pressed:border-ink aria-pressed:bg-panel-2 aria-selected:border-ink aria-selected:bg-panel-2',
        tone === 'danger' && 'bg-transparent text-red font-medium border-rule-strong hover:border-red hover:bg-panel',
        className,
      )}
    />
  );
}

/** The revision block's parts (DESIGN.md): a rule-strong table under the heavy ink-3 object line, its caption and header cells on panel, its body cells on ground. */
export const rev = {
  // text-left here, so a header cell starts at the left and a figure's cell can say text-right without a second alignment
  table: 'w-full border-collapse text-left text-small outline outline-ink-3',
  caption: 'caption-top px-2.5 py-2 text-left font-semibold border border-b-0 border-rule-strong bg-panel',
  th: 'px-2.5 py-1.5 border border-rule-strong align-top font-medium text-ink-2 bg-panel',
  td: 'px-2.5 py-1.5 border border-rule-strong align-top bg-ground',
};

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-[3px] border border-current font-mono text-[12px] font-medium leading-none opacity-80">{children}</kbd>;
}

/** A tab in a tab list: ink-2 at rest, ink with a 2 px ink underline when chosen. */
export const tabClass = (on: boolean) =>
  cx('inline-flex items-center gap-1.5 min-h-10 px-3 -mb-px whitespace-nowrap font-medium', on ? 'text-ink shadow-[inset_0_-2px_0_var(--ink)]' : 'text-ink-2 hover:text-ink');

/** A heading in the design's heading role, with an aside on the right. */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="py-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
