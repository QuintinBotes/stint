import { type Limits, type TaskLimits, weekOf } from '@stint-dev/core';
import { Command } from 'cmdk';
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ADAPTER_NAMES } from '../agents';
import { type CostRow, type DemoStatus, type Health, type TaskCardData, api, daemonMessage } from '../api';
import { toast } from 'sonner';
import { localDate, money } from '../format';
import { useGoals, useTasks } from '../hooks';
import { setSingleKeys, useSingleKeys } from '../shortcuts';
import { enableDesktopNotifications, setSound, soundOn } from './Notifier';
import { StatusMenu } from './StatusMenu';
import { Button, Explain, Kbd, trapTab } from './ui';

/** This week's spend, Monday 00:00 to Sunday 24:00 local time, from the daemon's week rows (the same weekOf as the daemon); zero when nothing has ended this week. */
function useWeekCost(): CostRow | null {
  const [rows, setRows] = useState<CostRow[] | null>(null);
  useEffect(() => {
    const load = () => void api.costs('week').then(setRows).catch(() => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (!rows) return null;
  const key = weekOf(new Date());
  return rows.find((r) => r.key === key) ?? { key, inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0, runs: 0, unpriced: 0 };
}

/** What the hosted credits have left, derived from metered spend; only hosts with a balance entered appear. */
function useCredits(): Array<{ host: string; left: number }> {
  const [rows, setRows] = useState<CostRow[] | null>(null);
  useEffect(() => {
    api
      .costs('host')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  return (rows ?? []).filter((r) => typeof r.creditsLeft === 'number').map((r) => ({ host: r.key, left: r.creditsLeft as number }));
}

export function TopBar({ health, unreachable, onPalette, onHelp }: { health: Health | null; unreachable: boolean; onPalette: () => void; onHelp: () => void }) {
  const week = useWeekCost();
  const credits = useCredits();
  const { pathname } = useLocation();
  const nav = [
    { to: '/', label: 'Board', on: pathname === '/' || pathname.startsWith('/t/') },
    { to: '/goals', label: 'Goals', on: pathname.startsWith('/goals') },
    { to: '/factory', label: 'Factory', on: pathname.startsWith('/factory') },
    { to: '/skills', label: 'Skills', on: pathname.startsWith('/skills') },
  ];
  const replay = health?.mode === 'replay';
  return (
    <header className="stint-topbar shrink-0">
      <div className="stint-brand-group max-sm:gap-2.5">
        <Link to="/" className="stint-brand">
          Stint
        </Link>
        {health?.repo ? (
          <span data-testid="repo-name" className="stint-project font-mono max-sm:max-w-[80px]" title={health.repo}>
            {health.repo}
          </span>
        ) : null}
      </div>
      <nav aria-label="Main" className="stint-nav">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} aria-current={n.on ? 'page' : undefined} className="stint-nav-link">
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="stint-utilities">
        <button
          type="button"
          onClick={onPalette}
          aria-keyshortcuts="Meta+K"
          data-testid="palette-button"
          className="inline-flex shrink-0 items-center gap-2.5 h-9 px-2.5 lg:min-w-[220px] rounded-md border border-field bg-ground text-ink-2 text-left hover:border-ink-2 hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 sm:hidden">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.4 10.4 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="hidden lg:inline flex-1">Search or run a command</span>
          <span className="max-sm:sr-only lg:hidden">Search</span>
          <span className="max-sm:hidden">
            <Kbd>⌘K</Kbd>
          </span>
        </button>
        <span
          className="whitespace-nowrap"
          data-testid="week-cost"
          title={
            replay
              ? `What the replayed runs cost when they were recorded${health?.replay?.recordedAt ? ` on ${localDate(health.replay.recordedAt)}` : ''}; replaying costs nothing.`
              : 'What every model call cost from Monday 00:00 to Sunday 24:00 local time: runs, and the learn step, packet quiz, digest, autopilot pick, board summaries and triage.'
          }
        >
          {/* the words stay for screen readers at every width; a phone shows the figure, with the words in its title */}
          <span className="max-sm:sr-only">{replay ? 'Replayed spend' : 'This week'} </span>
          <b className="text-ink font-semibold tabular">{week === null ? 'not known yet' : money(week)}</b>
          {week?.unpriced ? `, ${week.unpriced} not priced` : ''}
        </span>
        <StatusMenu health={health} unreachable={unreachable} credits={credits} />
        <Button tone="ghost" onClick={onHelp} aria-keyshortcuts="?" data-testid="help-button" className="px-2.5 max-sm:px-2 text-ink">
          Help
        </Button>
      </div>
    </header>
  );
}

export function ReplayStrip({ health }: { health: Health | null }) {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const replaying = health?.mode === 'replay';
  const done = !!status?.done;
  useEffect(() => {
    if (!replaying) return;
    const load = () => void api.demoStatus().then(setStatus).catch(() => undefined);
    load();
    // once the replay has finished there is little to follow; a slow check notices a new one starting
    const t = setInterval(load, done ? 10_000 : 1000);
    return () => clearInterval(t);
  }, [replaying, done]);
  if (!replaying || !health?.replay) return null;
  const r = health.replay;
  const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
  return (
    <div data-testid="replay-strip" className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 px-4 md:px-8 py-2 bg-shell border-b border-rule text-small text-ink-2">
      {/* honest about what it is (ADR-0011): a hand-written story, or a recording of a live run with its date */}
      <span className="inline-flex items-center min-h-6 px-2 rounded-sm border border-rule-strong font-medium text-ink">{r.live ? 'Replay' : 'Replay, hand-written'}</span>
      <span className="min-w-0">
        {r.live ? `A recording of a live run on ${localDate(r.recordedAt)}.` : 'A hand-written demo story, played back.'} Nothing runs and nothing is charged, so actions that start an agent are off here.
      </span>
      {status ? (
        <span className="hidden sm:inline whitespace-nowrap tabular">
          {status.playing ? (status.paused ? 'Paused' : 'Playing') : status.done ? 'Finished' : 'Stopped'}, {clock(status.at)} of {clock(status.total)}
        </span>
      ) : null}
      {status?.done ? (
        <Link to="/factory#any-harness" className="hidden sm:inline ml-auto text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink" data-testid="replay-close">
          Any harness, any model, one packet.
        </Link>
      ) : null}
    </div>
  );
}

/** `key` is the shortcut on the page, shown beside the command that does the same from a terminal. `group` places it. */
type Action = { id: string; label: string; cli: string; key?: string; group?: 'go' | 'settings' | 'notifications'; run: () => void };

/** What a daemon call said, as a toast: the daemon's own message when it refuses. */
function report(promise: Promise<unknown>, done: string): void {
  promise.then(() => toast.success(done)).catch((e: unknown) => toast.error(daemonMessage(e)));
}

/** Actions on the task that is open, each with the command that does the same from a terminal; a closed task only offers its views. */
function taskActions(id: string, card: TaskCardData | undefined, navigate: (to: string) => void, health: Health | null, search: string): Action[] {
  const params = new URLSearchParams(search);
  // looking back (R-065 4.3): the moment travels with a view, so choosing one keeps the clock where it is
  const moment = (q: URLSearchParams) => {
    for (const k of ['asOf', 'at']) if (params.has(k)) q.set(k, params.get(k) as string);
    return q;
  };
  const tab = (t: string) => () => navigate(`/t/${id}?${moment(new URLSearchParams({ tab: t }))}`);
  const closed = card ? ['approved', 'done', 'rejected', 'abandoned'].includes(card.task.status) : false;
  const atGate = card?.task.status === 'awaiting_approval';
  const onAutopilot = !!card?.autopilot?.on;
  const run = card?.lastRun && !card.lastRun.endedAt ? card.lastRun.run : null;
  // a replay daemon has no agents to start: the actions that need one say so
  const live = health?.mode === 'replay' ? ' (not in the replay)' : '';
  const views = new Set(['terminal', 'packet', 'diff', 'memory']);
  // one action per agent that can build now; none while a run is live, since a task holds one run at a time
  const assign: Action[] = run
    ? []
    : (health?.adapters ?? [])
        .filter((a) => a.id !== 'replay' && a.capability.level === 'supported' && a.roles.includes('implementer'))
        .map((a) => ({ id: `assign-${a.id}`, label: `Assign to ${ADAPTER_NAMES[a.id] ?? a.id}${live}`, cli: `stint assign ${id} ${a.id}`, run: () => report(api.assign(id, a.id), `${id}: ${ADAPTER_NAMES[a.id] ?? a.id} started`) }));
  const base = card?.task.baseCommit?.slice(0, 7) ?? 'main';
  // the views come first, so the item selected when the palette opens only ever shows something
  const actions: Action[] = [
    { id: 'diff', label: 'Show the diff', key: 'd', cli: `git diff ${base}..stint/${id}`, run: tab('diff') },
    { id: 'packet', label: 'Show the packet', key: 'h', cli: `stint packet ${id} --as prompt`, run: tab('packet') },
    { id: 'memory', label: 'Show the memory', key: 'm', cli: '', run: () => window.dispatchEvent(new CustomEvent('stint:memory')) },
    { id: 'terminal', label: 'Open the terminal in the worktree', key: 't', cli: `cd .stint/worktrees/${id}-${card?.lastRun?.run ?? 'r1'}`, run: tab('terminal') },
    ...(run ? [{ id: 'stop', label: `Stop the live run, ${run}`, key: '⌘.', cli: `stint stop ${id}`, run: () => report(api.stopRun(id, run), `${run} stopped`) }] : []),
    // approving is offered only at the gate; asking for changes or rejecting works on any open task
    ...(atGate ? [{ id: 'approve', label: 'Approve and merge', key: 'a', cli: `stint approve ${id}`, run: () => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'approve' })) }] : []),
    { id: 'changes', label: 'Request changes', key: 'r', cli: `stint changes ${id} --reason "..."`, run: () => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'changes' })) },
    { id: 'reject', label: 'Reject', key: 'x', cli: `stint reject ${id} --reason "..."`, run: () => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'reject' })) },
    { id: 'verify', label: 'Run the tests', cli: `stint verify ${id}`, run: () => report(api.verify(id), `${id}: tests run by Stint`) },
    { id: 'hand', label: 'Hand to another agent', cli: `stint hand ${id} <agent>`, run: tab('packet') },
    { id: 'autopilot-on', label: `Put on autopilot${live}`, cli: `stint run ${id}`, run: () => report(api.autopilot(id, true), `${id} is on autopilot`) },
    { id: 'autopilot-off', label: 'Take off autopilot', cli: `stint run ${id} --stop`, run: () => report(api.autopilot(id, false), `${id} is off autopilot`) },
    ...assign,
  ];
  if (params.has('asOf')) {
    // nothing acts on a task seen as it was: the views stay, and Return to latest stands in for every change
    const latest = new URLSearchParams(params);
    latest.delete('asOf');
    latest.delete('at');
    const back: Action = { id: 'return-to-latest', label: 'Return to latest', cli: '', run: () => navigate(`/t/${id}${latest.toString() ? `?${latest}` : ''}`) };
    return [back, ...actions.filter((a) => views.has(a.id))];
  }
  return actions.filter((a) => (closed ? views.has(a.id) : a.id !== (onAutopilot ? 'autopilot-on' : 'autopilot-off')));
}

/** Where the overlay that just closed would put focus back, while one that opens in its place takes it over. */
let handover: HTMLElement | null = null;

/** Focus on the page's main content, as Skip to content does: where focus goes when nothing nearer is left to take it. */
export function focusMain(): void {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  main.tabIndex = -1;
  main.focus();
}

const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * When the control that had focus leaves the page (a pressed button replaced by what it did, a run's Kill button once
 * the run ends), focus goes to the first control in the nearest part of the page still there, up to its landmark, else
 * to the main content, never to the page itself (R-072). A dialog gives focus back on its own (useRestoreFocus).
 */
export function useFocusRescue(): void {
  useEffect(() => {
    let had: Element | null = null;
    const onFocus = (e: FocusEvent) => {
      had = e.target instanceof Element ? e.target : null;
    };
    // a person who moved focus away left the control: its later removal takes nothing from them
    const onBlur = (e: FocusEvent) => {
      const t = e.target;
      queueMicrotask(() => {
        if (t === had && t instanceof Element && t.isConnected) had = null;
      });
    };
    const observer = new MutationObserver((records) => {
      const lost = had;
      if (!lost || lost.isConnected || (document.activeElement && document.activeElement !== document.body)) return;
      had = null;
      // a dialog that closed gives focus back itself; focus that left the page for a dialog opening is the dialog's
      const dialog = lost.closest<HTMLElement>('[aria-modal]');
      if (dialog ? !dialog.isConnected : document.querySelector('[aria-modal]')) return;
      const removal = records.find((r) => [...r.removedNodes].some((n) => n === lost || n.contains(lost)));
      // where the control stood: after the sibling before it, or at the start of its parent
      const before = removal?.previousSibling ?? null;
      const follows = (c: Node) => {
        const at = (before ?? (removal?.target as Node)).compareDocumentPosition(c);
        return before ? !!(at & Node.DOCUMENT_POSITION_FOLLOWING) && !(at & Node.DOCUMENT_POSITION_CONTAINED_BY) : !!(at & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY));
      };
      // focus stays where the person was; the view does not move, so a scroll the press began (Jump to latest) is kept
      const take = (c: HTMLElement) => {
        c.focus({ preventScroll: true });
        return document.activeElement === c;
      };
      for (let at = removal?.target instanceof Element ? removal.target : null; at?.isConnected && at !== document.body; at = at.parentElement) {
        // the nearest control after where it stood, else the nearest before it
        const all = [...at.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const after = all.filter(follows);
        if (after.some(take) || all.filter((c) => !follows(c)).reverse().some(take)) return;
        if (at.matches('main, aside, [aria-modal]')) break;
      }
      if (dialog) dialog.focus({ preventScroll: true });
      else focusMain();
    });
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      observer.disconnect();
    };
  }, []);
}

/**
 * Puts focus back where it was when an overlay opened, once it closes. An overlay opened as another closes (Write it
 * yourself, a palette command) returns focus to where the first was opened from, and nothing pulls focus out of it.
 */
function useRestoreFocus(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const before = active instanceof HTMLElement && active !== document.body ? active : handover;
    return () => {
      handover = before;
      requestAnimationFrame(() => {
        handover = null;
        if (document.querySelector('[aria-modal]')) return;
        // opened by a key, or its opener has gone: focus goes to the content rather than to the page itself
        if (before?.isConnected) before.focus();
        else if (!document.activeElement || document.activeElement === document.body) focusMain();
      });
    };
  }, [open]);
}

export function Palette({ open, onClose, actions: global, health }: { open: boolean; onClose: () => void; actions: Action[]; health: Health | null }) {
  const { data: tasks } = useTasks();
  const { data: goals } = useGoals();
  const navigate = useNavigate();
  const location = useLocation();
  useRestoreFocus(open);
  if (!open) return null;
  const taskId = /^\/t\/(T-\d+)/.exec(location.pathname)?.[1] ?? null;
  const go: Action[] = [
    { id: 'board', label: 'Board', cli: '/', run: () => navigate('/') },
    { id: 'goals', label: 'Goals', cli: 'stint goal list', run: () => navigate('/goals') },
    { id: 'factory', label: 'Factory', cli: '/factory', run: () => navigate('/factory') },
    { id: 'skills', label: 'Skills', cli: 'stint skills list', run: () => navigate('/skills') },
    ...(goals ?? []).map(({ goal: g }) => ({ id: `goal-${g.id}`, label: `${g.id}, ${g.title}`, cli: `stint goal show ${g.id}`, run: () => navigate(`/goals/${g.id}`) })),
    ...(tasks ?? []).map((c) => ({ id: `task-${c.task.id}`, label: `${c.task.id}, ${c.task.title}`, cli: `/t/${c.task.id}`, run: () => navigate(`/t/${c.task.id}`) })),
  ];
  const replay = health?.mode === 'replay' ? ' (not in the replay)' : '';
  // Run all starts paid work on every planned task, so it opens the Board's question of what it would start, not the work itself
  const actions: Action[] = [{ id: 'run-all', label: `Run all planned tasks on autopilot${replay}`, cli: 'stint run --all', run: () => navigate('/?run=all') }];
  const here = taskId ? taskActions(taskId, tasks?.find((c) => c.task.id === taskId), navigate, health, location.search) : [];
  const groups: Array<[string, Action[]]> = [
    [taskId ? `${taskId}${new URLSearchParams(location.search).has('asOf') ? ', as it was' : ''}` : 'This task', here],
    ['Actions', actions],
    ['Go to', [...global.filter((a) => a.group === 'go'), ...go]],
    ['Settings', global.filter((a) => a.group === 'settings')],
    ['Notifications', global.filter((a) => a.group === 'notifications')],
  ];
  const row = (a: Action) => (
    <Command.Item
      key={a.id}
      value={`${a.label} ${a.cli}`}
      // the action's id is a word people search by too: Verify finds Run the tests, which has no CLI of its own
      keywords={[a.id]}
      onSelect={() => {
        a.run();
        onClose();
      }}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 min-h-[52px] px-3.5 py-1.5 rounded-[3px] text-left text-ink cursor-pointer hover:bg-panel-2 data-[selected=true]:bg-panel-2"
    >
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="truncate">{a.label}</span>
        {a.cli ? <span className="font-mono text-small truncate text-ink-3">{a.cli}</span> : null}
      </span>
      {a.key ? <Kbd>{a.key}</Kbd> : <span />}
    </Command.Item>
  );
  return (
    <div className="fixed inset-0 z-50 bg-shell/70 flex items-start justify-center pt-[12vh] px-4" onMouseDown={onClose}>
      <Command
        label="Search or run a command"
        role="dialog"
        aria-modal="true"
        aria-label="Search or run a command"
        className="relative w-full max-w-[640px] flex flex-col rounded-[5px] border border-rule-strong bg-panel shadow-[var(--shadow)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          trapTab(e);
        }}
      >
        <div className="flex items-center gap-2.5 min-h-14 px-3.5 border-b border-rule-strong focus-within:border-ink">
          <Command.Input autoFocus placeholder="Search or run a command" className="flex-1 min-w-0 h-13 bg-transparent text-[16px] leading-6 text-ink outline-none focus-visible:outline-none placeholder:text-ink-3" />
          <Kbd>esc</Kbd>
        </div>
        <Command.List className="max-h-[min(52vh,480px)] overflow-y-auto px-1.5 py-1">
          <Command.Empty className="px-3.5 py-4 text-ink-2">Nothing matches. Try approve, hand, verify, or packet.</Command.Empty>
          {groups.map(([heading, items]) =>
            items.length ? (
              <Command.Group key={heading} heading={heading} className="[&_[cmdk-group-heading]]:px-3.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-small [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-2">
                {items.map(row)}
              </Command.Group>
            ) : null,
          )}
        </Command.List>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-3.5 py-2.5 border-t border-rule text-small text-ink-2">
          <span>Each command is the one you would type in a terminal.</span>
          <span>Enter runs it. Escape closes.</span>
        </div>
      </Command>
    </div>
  );
}

/**
 * A modal in the charcoal system: a header with the title and a visible Close, a body that scrolls, and an optional footer
 * that stays in reach below it. With `dirty`, a dismissal (Escape, Close, a click outside) asks before it drops the draft:
 * the footer becomes "Discard this draft?" with Keep editing first, and Escape there keeps editing. A `footer` given as a
 * function receives that guarded dismissal, so a Cancel in it asks first too.
 */
export function Dialog({ title, open, onClose, children, footer, dirty = false, width = 640 }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode | ((dismiss: () => void) => ReactNode); dirty?: boolean; width?: number }) {
  useRestoreFocus(open);
  const box = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  const dismiss = () => (dirty ? setAsking(true) : onClose());
  useEffect(() => {
    if (!open) setAsking(false);
  }, [open]);
  useEffect(() => {
    if (asking) keep.current?.focus();
  }, [asking]);
  // focus moves into the dialog when it opens, unless a field inside already took it
  useEffect(() => {
    if (open && !box.current?.contains(document.activeElement)) box.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (asking) setAsking(false);
      else if (dirty) setAsking(true);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dirty, asking]);
  if (!open) return null;
  const foot = typeof footer === 'function' ? footer(dismiss) : footer;
  return (
    <div className="fixed inset-0 z-50 bg-shell/75 flex items-start justify-center pt-[8vh] px-4" onMouseDown={dismiss}>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal
        aria-label={title}
        className="stint-dialog outline-none"
        style={{ width: `min(${width}px, calc(100vw - 32px))`, maxHeight: 'calc(100dvh - 8vh - 16px)' }}
        onMouseDown={(e) => e.stopPropagation()}
        // a key pressed in a dialog stays in it: the page's single-key shortcuts do not fire behind it; Escape and Cmd+K still reach the window
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key !== 'Escape' && !e.metaKey && !e.ctrlKey) e.stopPropagation();
        }}
      >
        <div className="stint-dialog-header">
          <h2 className="text-section">{title}</h2>
          <Button tone="ghost" className="-my-1.5 -mr-2 px-2" onClick={dismiss} data-testid="dialog-close">
            Close
          </Button>
        </div>
        <div className="stint-dialog-body">{children}</div>
        {asking ? (
          <div className="stint-dialog-footer justify-between" role="alertdialog" aria-label="Discard this draft?" data-testid="dialog-discard">
            <p className="text-small">Discard this draft? What you typed is lost.</p>
            <div className="stint-actions">
              <Button ref={keep} onClick={() => setAsking(false)}>
                Keep editing
              </Button>
              <Button tone="danger" onClick={onClose}>
                Discard
              </Button>
            </div>
          </div>
        ) : foot ? (
          <div className="stint-dialog-footer">{foot}</div>
        ) : null}
      </div>
    </div>
  );
}

/** The limits the new task form offers; review rounds are set from the command line and config only (R-062). */
const LIMIT_FIELDS: Array<{ k: keyof Limits; label: string; hint: string; min: number; max: number; step: number }> = [
  { k: 'builds', label: 'Builds', hint: 'Agent runs that build the change.', min: 1, max: 50, step: 1 },
  { k: 'handoffs', label: 'Hand-offs', hint: 'Times autopilot gives the task to another agent.', min: 0, max: 20, step: 1 },
  { k: 'usd', label: 'Spend in dollars', hint: 'What its runs and model calls may cost.', min: 0.01, max: 1000, step: 0.01 },
  { k: 'minutes', label: 'Agent minutes', hint: 'Time agents spend running on it.', min: 1, max: 1440, step: 1 },
];

/** A create dialog's form: whether anything is typed, the request in flight, and what the daemon said when it refused. Cleared when the dialog closes. */
export function useDraft(open: boolean) {
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (open) return;
    setDirty(false);
    setPending(false);
    setError(null);
    busy.current = false;
  }, [open]);
  return {
    dirty,
    pending,
    error,
    setError,
    onChange: (e: FormEvent<HTMLFormElement>) => setDirty([...new FormData(e.currentTarget).values()].some((v) => typeof v === 'string' && v.trim() !== '')),
    /** Sends once: a second press while the first is in flight does nothing, and a refusal keeps the form as typed. */
    send<T>(call: () => Promise<T>, done: (v: T) => void, refused: string) {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setError(null);
      call()
        .then(done)
        .catch((err: unknown) => setError(`${refused}: ${daemonMessage(err)}`))
        .finally(() => {
          busy.current = false;
          setPending(false);
        });
    },
  };
}

/** A labelled field; its hint sits under it and is read with it through aria-describedby on the control. */
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="stint-field-group">
      <label htmlFor={id} className="stint-field-label">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="stint-field-help">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The footer of a create dialog: the daemon's message beside the action when it refused, Cancel, which asks first once anything is typed, and the action, which says when it is working. */
function CreateFooter({ form, pending, error, label, working, dismiss }: { form: string; pending: boolean; error: string | null; label: string; working: string; dismiss: () => void }) {
  return (
    <>
      {error ? (
        <p role="alert" className="stint-field-error basis-full">
          {error}
        </p>
      ) : null}
      <Button onClick={dismiss}>Cancel</Button>
      <Button tone="primary" type="submit" form={form} aria-disabled={pending} aria-busy={pending}>
        {pending ? working : label}
      </Button>
    </>
  );
}

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

export function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const id = useId();
  const draft = useDraft(open);
  const [defaults, setDefaults] = useState<Limits | null>(null);
  useEffect(() => {
    if (open) void api.limitDefaults().then(setDefaults).catch(() => undefined);
  }, [open]);
  return (
    <Dialog title="New task" open={open} onClose={onClose} dirty={draft.dirty} footer={(dismiss) => <CreateFooter form={`${id}-form`} pending={draft.pending} error={draft.error} label="Create task" working="Creating task" dismiss={dismiss} />}>
      <form
        id={`${id}-form`}
        className="grid gap-5"
        onChange={draft.onChange}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          // a limit left empty takes the default
          const limits: TaskLimits = {};
          for (const { k } of LIMIT_FIELDS) if (f.get(k)) limits[k] = Number(f.get(k));
          draft.send(
            () => api.createTask({ title: String(f.get('title')), goal: String(f.get('goal')), acceptance: lines(f.get('acceptance')), ...(f.get('test') ? { testCommand: String(f.get('test')) } : {}), ...(Object.keys(limits).length ? { limits } : {}) }),
            (t) => {
              onClose();
              // the task view starts the round itself, so its questions arrive where they are answered (R-064)
              navigate(`/t/${t.id}${f.get('sharpen') ? '?sharpen=1' : ''}`);
            },
            'The task was not created',
          );
        }}
      >
        <p className="stint-field-help">Describe the work. It waits in Planned until you give it to an agent or turn on autopilot.</p>
        <Field id={`${id}-title`} label="Title">
          <input id={`${id}-title`} name="title" required maxLength={120} className="stint-input" />
        </Field>
        <Field id={`${id}-goal`} label="Goal">
          <textarea id={`${id}-goal`} name="goal" required rows={3} className="stint-input" />
        </Field>
        <Field id={`${id}-acceptance`} label="How you will know it is done, one check per line">
          <textarea id={`${id}-acceptance`} name="acceptance" required rows={3} className="stint-input" />
        </Field>
        <Field id={`${id}-test`} label="Command that runs the tests" hint="Stint runs it itself to check the work. Leave it empty to use the one in this project's settings.">
          <input id={`${id}-test`} name="test" placeholder="bun test" aria-describedby={`${id}-test-hint`} className="stint-input font-mono" />
        </Field>
        <details data-testid="new-task-limits" className="rounded-md border border-rule">
          <summary className="min-h-10 px-3 py-2.5 rounded-md font-medium cursor-pointer hover:bg-surface-hover">Limits</summary>
          <div className="grid gap-4 px-3 pt-1 pb-4">
            <p className="stint-field-help">Autopilot stops and asks you before the task goes past one. Leave a field empty for the default shown in it.</p>
            <div className="grid grid-cols-1 min-[440px]:grid-cols-2 gap-4">
              {LIMIT_FIELDS.map(({ k, label, hint, min, max, step }) => {
                const d = defaults?.[k];
                return (
                  <Field key={k} id={`${id}-${k}`} label={label} hint={hint}>
                    <input
                      id={`${id}-${k}`}
                      name={k}
                      type="number"
                      min={min}
                      max={max}
                      step={step}
                      inputMode={step < 1 ? 'decimal' : 'numeric'}
                      placeholder={d === undefined ? '' : d === null ? 'No limit' : k === 'usd' ? d.toFixed(2) : String(d)}
                      aria-describedby={`${id}-${k}-hint`}
                      className="stint-input tabular"
                    />
                  </Field>
                );
              })}
            </div>
            <Explain word="limit" />
          </div>
        </details>
        <div className="grid gap-1.5">
          <label className="inline-flex items-center gap-2.5 min-h-6 w-fit stint-field-label">
            <input type="checkbox" name="sharpen" aria-describedby={`${id}-sharpen-hint`} />
            Sharpen it first
          </label>
          <p id={`${id}-sharpen-hint`} className="stint-field-help">
            Before any agent starts, Stint asks the few questions whose answers change what gets built, and recommends an answer to each.
          </p>
        </div>
      </form>
    </Dialog>
  );
}

/** A new goal (R-064): an outcome, its criteria and non-goals one per line, and limits for all its tasks. */
export function NewGoalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const id = useId();
  const draft = useDraft(open);
  return (
    <Dialog title="New goal" open={open} onClose={onClose} dirty={draft.dirty} footer={(dismiss) => <CreateFooter form={`${id}-form`} pending={draft.pending} error={draft.error} label="Create goal" working="Creating goal" dismiss={dismiss} />}>
      <form
        id={`${id}-form`}
        className="grid gap-5"
        onChange={draft.onChange}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const limits: TaskLimits = {};
          if (f.get('usd')) limits.usd = Number(f.get('usd'));
          if (f.get('builds')) limits.builds = Number(f.get('builds'));
          const nonGoals = lines(f.get('nonGoals'));
          const criteria = lines(f.get('criteria'));
          // said before the daemon has to: the schema's own bounds, in words
          if (criteria.length < 1 || criteria.length > 12) return draft.setError(`A goal takes 1 to 12 criteria, one per line; this has ${criteria.length}.`);
          if (criteria.some((c) => c.length > 300)) return draft.setError('Each criterion fits in 300 characters.');
          if (nonGoals.length > 8) return draft.setError(`A goal takes at most 8 non-goals; this has ${nonGoals.length}.`);
          draft.send(
            () => api.createGoal({ title: String(f.get('title')), outcome: String(f.get('outcome')), criteria, ...(nonGoals.length ? { nonGoals } : {}), ...(Object.keys(limits).length ? { limits } : {}) }),
            (g) => {
              onClose();
              navigate(`/goals/${g.id}`);
            },
            'The goal was not created',
          );
        }}
      >
        <p className="stint-field-help">Describe an outcome bigger than one task. Stint can sharpen it with you, then split it into tasks you check before any is created.</p>
        <Field id={`${id}-title`} label="Title">
          <input id={`${id}-title`} name="title" required maxLength={120} className="stint-input" />
        </Field>
        <Field id={`${id}-outcome`} label="Outcome: what is true once it is met">
          <textarea id={`${id}-outcome`} name="outcome" required maxLength={2000} rows={3} className="stint-input" />
        </Field>
        <Field id={`${id}-criteria`} label="Success criteria, one per line">
          <textarea id={`${id}-criteria`} name="criteria" required rows={3} className="stint-input" />
        </Field>
        <Field id={`${id}-non-goals`} label="Not in scope, one per line" hint="Optional. What the goal leaves out, so no task takes it on.">
          <textarea id={`${id}-non-goals`} name="nonGoals" rows={2} aria-describedby={`${id}-non-goals-hint`} className="stint-input min-h-[72px]" />
        </Field>
        <details data-testid="new-goal-limits" className="rounded-md border border-rule">
          <summary className="min-h-10 px-3 py-2.5 rounded-md font-medium cursor-pointer hover:bg-surface-hover">Limits</summary>
          <div className="grid gap-4 px-3 pt-1 pb-4">
            <p className="stint-field-help">Counted across all the goal's tasks. Autopilot stops a build that would go past one, and each task takes its share. Leave a field empty for no limit.</p>
            <div className="grid grid-cols-1 min-[440px]:grid-cols-2 gap-4">
              <Field id={`${id}-usd`} label="Spend in dollars">
                <input id={`${id}-usd`} name="usd" type="number" min={0.01} max={1000} step={0.01} inputMode="decimal" placeholder="No limit" className="stint-input tabular" />
              </Field>
              <Field id={`${id}-builds`} label="Builds">
                <input id={`${id}-builds`} name="builds" type="number" min={1} max={50} step={1} inputMode="numeric" placeholder="No limit" className="stint-input tabular" />
              </Field>
            </div>
            <Explain word="limit" />
          </div>
        </details>
      </form>
    </Dialog>
  );
}

/** Actions that need nothing from the router; the palette adds navigation and the open task's actions itself. */
export function usePaletteActions(extra: { newTask: () => void; newGoal: () => void }): Action[] {
  const [sound, setSoundState] = useState(soundOn);
  const singleKeys = useSingleKeys();
  return useMemo(
    () => [
      { id: 'new', label: 'New task', key: 'n', cli: 'stint draft "..."', group: 'go' as const, run: extra.newTask },
      { id: 'new-goal', label: 'New goal', cli: 'stint draft "..." --goal', group: 'go' as const, run: extra.newGoal },
      {
        id: 'notifications',
        label: 'Turn on desktop notifications',
        cli: '',
        group: 'notifications' as const,
        run: () =>
          void enableDesktopNotifications().then((result) => {
            if (result === 'granted') toast.success('Desktop notifications are on. A run finishing or a task needing you will say so outside this window.');
            else if (result === 'denied') toast.error('Desktop notifications stay off: the browser refused permission.');
            else toast.error('This browser has no desktop notifications.');
          }),
      },
      {
        id: 'single-keys',
        label: singleKeys ? 'Turn single-key shortcuts off' : 'Turn single-key shortcuts on',
        cli: '',
        group: 'settings' as const,
        run: () => {
          setSingleKeys(!singleKeys);
          toast.success(singleKeys ? 'Single-key shortcuts are off. Cmd+K and Cmd+. still work.' : 'Single-key shortcuts are on: n, d, m, a and the rest.');
        },
      },
      {
        id: 'sound',
        label: sound ? 'Turn sound off' : 'Turn sound on',
        cli: '',
        group: 'notifications' as const,
        run: () => {
          setSound(!sound);
          setSoundState(!sound);
          toast.success(sound ? 'The needs-you sound is off.' : 'The needs-you sound is on.');
        },
      },
    ],
    [extra.newTask, extra.newGoal, sound, singleKeys],
  );
}
