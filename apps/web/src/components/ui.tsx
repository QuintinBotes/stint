import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';
import { type Agent, markColor } from '../agents';
import { GLOSSARY, type Word } from '../glossary';

/** Keeps Tab inside a modal: past the last control it wraps to the first, and Shift+Tab the other way. */
export function trapTab(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Tab') return;
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter((el) => el.getClientRects().length > 0);
  const first = all[0];
  const last = all.at(-1);
  if (!first || !last) return;
  if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

/** The ARIA tabs pattern on a tab list: arrow keys, Home and End move between tabs and choose the one they land on. Each tab takes tabIndex 0 when chosen, else -1. */
export function tabKeys(e: KeyboardEvent<HTMLElement>) {
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const to = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  tabs[to]?.focus();
  tabs[to]?.click();
}

/** A word explained in plain language, behind a question the reader can open: a native disclosure, so any keyboard and screen reader can use it. */
export function Explain({ word, className }: { word: Word; className?: string }) {
  const g = GLOSSARY[word];
  return (
    <details className={cx('text-small text-ink-2', className)}>
      <summary className="w-fit leading-6 cursor-pointer underline decoration-dotted decoration-ink-3 underline-offset-4 hover:text-ink">{g.ask}</summary>
      <p className="mt-1 max-w-[60ch]">{g.plain}</p>
    </details>
  );
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Who did the work: the vendor's ink square and the agent or model name, always together. `live` breathes the square while a run is going; the caller sets the weight. */
export function Who({ agent, live = false, className }: { agent: Agent; live?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 min-w-0 whitespace-nowrap', className)}>
      <span aria-hidden="true" className={cx('size-2.5 shrink-0 ', live && 'live-spine')} style={{ background: markColor[agent.mark] }} />
      <span className="truncate">{agent.name}</span>
    </span>
  );
}

export type ChipTone = 'neutral' | 'active' | 'good' | 'warn' | 'bad' | 'merged' | 'learned' | 'recommend';

/** A state's shape, drawn beside its word so no state rests on colour: a triangle needs you, a tick verified, a cross failed, a dot runs, a ring waits, a square is closed, a bar was abandoned, a diamond was learned. */
export type Shape = 'attention' | 'verified' | 'failed' | 'running' | 'waiting' | 'closed' | 'abandoned' | 'learned';

/** A tone's class on the stint-status label: amber needs you, green verified, red stopped, violet learned; merged, closed and waiting stay neutral. */
const CHIP: Record<ChipTone, string> = {
  neutral: '',
  active: 'stint-status--active',
  good: 'stint-status--verified',
  warn: 'stint-status--attention',
  bad: 'stint-status--failed',
  merged: '',
  learned: 'stint-status--learned',
  recommend: 'stint-status--recommend',
};

const TONE_SHAPE: Partial<Record<ChipTone, Shape>> = { good: 'verified', warn: 'attention', bad: 'failed', active: 'running', merged: 'closed', learned: 'learned' };

const STATUS: Record<string, { label: string; tone: ChipTone; shape: Shape }> = {
  planned: { label: 'planned', tone: 'neutral', shape: 'waiting' },
  building: { label: 'building', tone: 'active', shape: 'running' },
  verifying: { label: 'verifying', tone: 'active', shape: 'running' },
  reviewing: { label: 'reviewing', tone: 'active', shape: 'running' },
  // a pull request waiting on review: nothing of Stint's is running
  in_review: { label: 'in PR review', tone: 'neutral', shape: 'waiting' },
  awaiting_approval: { label: 'awaiting approval', tone: 'warn', shape: 'attention' },
  approved: { label: 'approved', tone: 'merged', shape: 'closed' },
  rejected: { label: 'rejected', tone: 'bad', shape: 'failed' },
  done: { label: 'done', tone: 'merged', shape: 'closed' },
  abandoned: { label: 'abandoned', tone: 'neutral', shape: 'abandoned' },
  running: { label: 'running', tone: 'active', shape: 'running' },
  draft: { label: 'draft', tone: 'neutral', shape: 'waiting' },
  ready: { label: 'ready', tone: 'active', shape: 'waiting' },
  completed: { label: 'finished', tone: 'neutral', shape: 'closed' },
  killed: { label: 'killed', tone: 'bad', shape: 'failed' },
  capped: { label: 'capped', tone: 'warn', shape: 'attention' },
  failed: { label: 'failed', tone: 'bad', shape: 'failed' },
  handed: { label: 'handed off', tone: 'neutral', shape: 'closed' },
  green: { label: 'green', tone: 'good', shape: 'verified' },
  red: { label: 'red', tone: 'bad', shape: 'failed' },
};

const SHAPE_PATH: Record<Shape, ReactNode> = {
  attention: <path d="M5 0.8 9.6 9.2H0.4Z" fill="currentColor" />,
  verified: <path d="M1.2 5.4 3.9 8.1 8.8 2.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  failed: <path d="M1.8 1.8 8.2 8.2M8.2 1.8 1.8 8.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  running: <circle cx="5" cy="5" r="3.6" fill="currentColor" />,
  waiting: <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  closed: <rect x="1.5" y="1.5" width="7" height="7" fill="currentColor" />,
  abandoned: <path d="M1.5 5h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  learned: <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill="currentColor" />,
};

/** A state's shape as a 10 px mark in the current ink; hidden from screen readers, since the word beside it says the same. */
export function StateMark({ shape, className }: { shape: Shape; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" width="10" height="10" data-shape={shape} className={cx('shrink-0 forced-colors:text-[CanvasText]', className)}>
      {SHAPE_PATH[shape]}
    </svg>
  );
}

/** A status as a label: its shape and its word, on the state's wash when it has one. */
export function StatusChip({ status, label, tone, shape }: { status?: string; label?: string; tone?: ChipTone; shape?: Shape }) {
  const s = status ? STATUS[status] : undefined;
  const t = tone ?? s?.tone ?? 'neutral';
  const mark = shape ?? (tone ? TONE_SHAPE[tone] : s?.shape);
  return (
    <span data-status={status} className={cx('stint-status', CHIP[t])}>
      {mark ? <StateMark shape={mark} /> : null}
      {/* sentence case on screen; the words stay as the daemon and the tests name them */}
      <span className="inline-block first-letter:uppercase">{label ?? s?.label ?? status}</span>
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

type ButtonTone = 'primary' | 'quiet' | 'danger' | 'ghost';
const BUTTON: Record<ButtonTone, string> = {
  primary: 'stint-button stint-button--primary',
  quiet: 'stint-button',
  danger: 'stint-button stint-button--danger',
  ghost: 'stint-button stint-button--quiet',
};
/** A button in the charcoal system. A caller's height, padding or size utility wins over the component class. aria-disabled only says the state, so the click is stopped here too. */
export function Button({ tone = 'quiet', className, onClick, ...rest }: ComponentProps<'button'> & { tone?: ButtonTone }) {
  const off = rest['aria-disabled'] === true || rest['aria-disabled'] === 'true';
  return <button type="button" {...rest} onClick={off ? (e) => e.preventDefault() : onClick} className={cx(BUTTON[tone], className)} />;
}

/**
 * Table parts (DESIGN.md). An ordinary table is quiet: a header row on panel and a rule between rows. `block` is the heavy
 * revision block, a rule-strong grid inside an ink-3 object line, kept for history, provenance and approval structures: the
 * revision block, the packet header and a skill's versions.
 */
export const rev = {
  // text-left here, so a header cell starts at the left and a figure's cell can say text-right without a second alignment
  table: 'w-full border-collapse text-left text-small',
  block: 'w-full border-collapse text-left text-small outline outline-ink-3 [&_th]:border [&_td]:border [&_th]:border-rule-strong [&_td]:border-rule-strong [&_td]:bg-ground',
  caption: 'caption-top px-3 py-2 text-left font-semibold border border-b-0 border-rule-strong bg-panel',
  th: 'px-3 py-2 border-b border-rule align-top font-medium text-ink-3 bg-panel',
  td: 'px-3 py-2 border-b border-rule align-top',
};

/** A key hint on a control. Hidden from screen readers, so a button's name is its words alone; the control carries aria-keyshortcuts instead. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd aria-hidden="true" className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-[3px] border border-current font-mono text-small font-medium leading-none opacity-80">
      {children}
    </kbd>
  );
}

/** A tab in a tab list: ink-2 at rest, ink with a 2 px ink underline when chosen. */
export const tabClass = (on: boolean) =>
  cx('inline-flex items-center gap-1.5 min-h-10 px-3 -mb-px whitespace-nowrap font-medium', on ? 'text-ink shadow-[inset_0_-2px_0_var(--ink)] forced-colors:border-b-2' : 'text-ink-2 hover:text-ink');

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
