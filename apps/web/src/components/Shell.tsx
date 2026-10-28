import { type Limits, type TaskLimits, weekOf } from '@stint-dev/core';
import { Command } from 'cmdk';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ADAPTER_NAMES } from '../agents';
import { type CostRow, type DemoStatus, type Health, type TaskCardData, api, daemonMessage } from '../api';
import { toast } from 'sonner';
import { localDate, money } from '../format';
import { useTasks } from '../hooks';
import { setSingleKeys, useSingleKeys } from '../shortcuts';
import { enableDesktopNotifications, setSound, soundOn } from './Notifier';
import { StatusMenu } from './StatusMenu';
import { Button, Explain, Kbd, cx, trapTab } from './ui';

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
    { to: '/factory', label: 'Factory', on: pathname.startsWith('/factory') },
    { to: '/skills', label: 'Skills', on: pathname.startsWith('/skills') },
  ];
  return (
    <header className="shrink-0 flex flex-wrap items-center gap-x-5 gap-y-2 min-h-[52px] px-4 md:px-6 py-2 bg-shell border-b border-rule">
      <div className="flex items-baseline gap-2.5 min-w-0">
        <Link to="/" className="inline-flex items-center min-h-6 text-section tracking-[-0.01em] no-underline">
          Stint
        </Link>
        {health?.repo ? (
          <span data-testid="repo-name" className="font-mono text-small text-ink-2 truncate">
            {health.repo}
          </span>
        ) : null}
      </div>
      <nav aria-label="Main" className="flex gap-1">
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            aria-current={n.on ? 'page' : undefined}
            className={cx('inline-flex items-center h-9 px-2.5 rounded-[3px] font-medium no-underline hover:bg-panel hover:text-ink', n.on ? 'text-ink shadow-[inset_0_-2px_0_var(--ink)]' : 'text-ink-2')}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onPalette}
        data-testid="palette-button"
        className="inline-flex shrink-0 items-center gap-2.5 h-9 px-2.5 md:min-w-[240px] rounded-[5px] border border-field bg-ground text-ink-2 text-left hover:border-ink-2"
      >
        <span className="hidden md:inline flex-1">Search or run a command</span>
        <span className="md:hidden">Search</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0 text-small text-ink-2">
        <span
          className="whitespace-nowrap"
          data-testid="week-cost"
          title={
            health?.mode === 'replay'
              ? `What the replayed runs cost when they were recorded${health.replay?.recordedAt ? ` on ${localDate(health.replay.recordedAt)}` : ''}; replaying costs nothing.`
              : 'What every model call cost from Monday 00:00 to Sunday 24:00 local time: runs, and the learn step, packet quiz, digest, autopilot pick, board summaries and triage.'
          }
        >
          {health?.mode === 'replay' ? 'Replayed spend' : 'This week'} <b className="text-ink font-semibold">{week === null ? 'not known yet' : money(week)}</b>
          {week?.unpriced ? `, ${week.unpriced} not priced` : ''}
        </span>
        <StatusMenu health={health} unreachable={unreachable} credits={credits} />
        <button type="button" onClick={onHelp} aria-keyshortcuts="?" data-testid="help-button" className="inline-flex items-center h-9 px-2.5 rounded-[5px] font-medium text-ink hover:bg-panel">
          Help
        </button>
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
    <div data-testid="replay-strip" className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 px-4 md:px-6 py-1.5 border-b border-rule text-small text-ink-2">
      <span className="inline-flex items-center h-6 px-2 rounded-[3px] bg-panel-2 font-medium">Replay</span>
      <span>{r.live ? `A recording of a live run on ${localDate(r.recordedAt)}. Nothing runs and nothing is charged.` : 'A recorded demo. Nothing runs and nothing is charged.'}</span>
      {status ? (
        <span className="hidden sm:inline whitespace-nowrap">
          {status.playing ? (status.paused ? 'paused' : 'playing') : status.done ? 'finished' : 'stopped'}, {clock(status.at)} of {clock(status.total)}
        </span>
      ) : null}
      {status?.done ? (
        <Link to="/factory#any-harness" className="hidden sm:inline ml-auto text-ink underline decoration-rule-strong hover:decoration-ink" data-testid="replay-close">
          Any harness, any model, one packet.
        </Link>
      ) : null}
    </div>
  );
}

/** `key` is the shortcut on the page, shown beside the command that does the same from a terminal. `group` places it. */
type Action = { id: string; label: string; cli: string; key?: string; group?: 'actions' | 'go' | 'settings' | 'notifications'; run: () => void };

/** What a daemon call said, as a toast: the daemon's own message when it refuses. */
function report(promise: Promise<unknown>, done: string): void {
  promise.then(() => toast.success(done)).catch((e: unknown) => toast.error(daemonMessage(e)));
}

/** Actions on the task that is open, each with the command that does the same from a terminal; a closed task only offers its views. */
function taskActions(id: string, card: TaskCardData | undefined, navigate: (to: string) => void, health: Health | null): Action[] {
  const tab = (t: string) => () => navigate(`/t/${id}?tab=${t}`);
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
    ...(run ? [{ id: 'stop', label: `Stop the live run, ${run}`, key: '⌘.', cli: '', run: () => report(api.stopRun(id, run), `${run} stopped`) }] : []),
    // approving is offered only at the gate; asking for changes or rejecting works on any open task
    ...(atGate ? [{ id: 'approve', label: 'Approve and merge', key: 'a', cli: `stint approve ${id}`, run: () => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'approve' })) }] : []),
    { id: 'changes', label: 'Request changes', key: 'r', cli: `stint reject ${id} --reason "..."`, run: () => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'changes' })) },
    { id: 'reject', label: 'Reject', key: 'x', cli: `stint reject ${id} --reason "..."`, run: () => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'reject' })) },
    { id: 'verify', label: 'Run the tests', cli: `stint verify ${id}`, run: () => report(api.verify(id), `${id}: tests run by Stint`) },
    { id: 'hand', label: 'Hand to another agent', cli: `stint hand ${id} <agent>`, run: tab('packet') },
    { id: 'autopilot-on', label: `Put on autopilot${live}`, cli: `stint run ${id}`, run: () => report(api.autopilot(id, true), `${id} is on autopilot`) },
    { id: 'autopilot-off', label: 'Take off autopilot', cli: `stint run ${id} --stop`, run: () => report(api.autopilot(id, false), `${id} is off autopilot`) },
    ...assign,
  ];
  return actions.filter((a) => (closed ? views.has(a.id) : a.id !== (onAutopilot ? 'autopilot-on' : 'autopilot-off')));
}

/** Puts focus back where it was when an overlay opened, once it closes. */
function useRestoreFocus(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (before?.isConnected) requestAnimationFrame(() => before.focus());
    };
  }, [open]);
}

export function Palette({ open, onClose, actions: global, health }: { open: boolean; onClose: () => void; actions: Action[]; health: Health | null }) {
  const { data: tasks } = useTasks();
  const navigate = useNavigate();
  const location = useLocation();
  useRestoreFocus(open);
  if (!open) return null;
  const taskId = /^\/t\/(T-\d+)/.exec(location.pathname)?.[1] ?? null;
  const go: Action[] = [
    { id: 'board', label: 'Board', cli: '/', run: () => navigate('/') },
    { id: 'factory', label: 'Factory', cli: '/factory', run: () => navigate('/factory') },
    { id: 'skills', label: 'Skills', cli: 'stint skills list', run: () => navigate('/skills') },
    ...(tasks ?? []).map((c) => ({ id: `task-${c.task.id}`, label: `${c.task.id}, ${c.task.title}`, cli: `/t/${c.task.id}`, run: () => navigate(`/t/${c.task.id}`) })),
  ];
  const replay = health?.mode === 'replay' ? ' (not in the replay)' : '';
  const here = taskId ? taskActions(taskId, tasks?.find((c) => c.task.id === taskId), navigate, health) : [];
  const groups: Array<[string, Action[]]> = [
    [taskId ?? 'This task', here],
    ['Actions', global.filter((a) => a.group === 'actions').map((a) => (a.id === 'run-all' ? { ...a, label: `${a.label}${replay}` } : a))],
    ['Go to', [...global.filter((a) => a.group === 'go'), ...go]],
    ['Settings', global.filter((a) => a.group === 'settings')],
    ['Notifications', global.filter((a) => a.group === 'notifications')],
  ];
  const row = (a: Action) => (
    <Command.Item
      key={a.id}
      value={`${a.label} ${a.cli}`}
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

export function Dialog({ title, open, onClose, children, width = 'max-w-[520px]' }: { title: string; open: boolean; onClose: () => void; children: ReactNode; width?: string }) {
  useRestoreFocus(open);
  const box = useRef<HTMLDivElement>(null);
  // focus moves into the dialog when it opens, unless a field inside already took it
  useEffect(() => {
    if (open && !box.current?.contains(document.activeElement)) box.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-shell/70 flex items-start justify-center pt-[10vh] px-4" onMouseDown={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal
        aria-label={title}
        className={cx('relative w-full max-h-[85vh] outline-none overflow-y-auto rounded-[5px] border border-rule-strong bg-panel p-6', width)}
        onMouseDown={(e) => e.stopPropagation()}
        // a key pressed in a dialog stays in it: the page's single-key shortcuts do not fire behind it; Escape and Cmd+K still reach the window
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key !== 'Escape' && !e.metaKey && !e.ctrlKey) e.stopPropagation();
        }}
      >
        <h2 className="text-section mb-4">{title}</h2>
        {children}
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

export function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Limits | null>(null);
  useEffect(() => {
    if (open) void api.limitDefaults().then(setDefaults).catch(() => undefined);
  }, [open]);
  const field = 'w-full rounded-[5px] border border-field bg-ground px-3 py-2 text-ink placeholder:text-ink-3';
  const label = 'flex flex-col gap-1.5 font-medium';
  return (
    <Dialog title="New task" open={open} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const acceptance = String(f.get('acceptance') ?? '')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          // a limit left empty takes the default
          const limits: TaskLimits = {};
          for (const { k } of LIMIT_FIELDS) if (f.get(k)) limits[k] = Number(f.get(k));
          setError(null);
          api
            .createTask({ title: String(f.get('title')), goal: String(f.get('goal')), acceptance, ...(f.get('test') ? { testCommand: String(f.get('test')) } : {}), ...(Object.keys(limits).length ? { limits } : {}) })
            .then((t) => {
              onClose();
              // the task view starts the round itself, so its questions arrive where they are answered (R-064)
              navigate(`/t/${t.id}${f.get('sharpen') ? '?sharpen=1' : ''}`);
            })
            .catch((err: unknown) => setError(`The task was not created: ${err instanceof Error ? err.message : String(err)}`));
        }}
      >
        <p className="text-small text-ink-2 -mt-2">Describe the work. It waits in Planned until you give it to an agent or turn on autopilot.</p>
        <label className={label}>
          Title
          <input name="title" required maxLength={120} className={field} />
        </label>
        <label className={label}>
          Goal
          <textarea name="goal" required rows={3} className={field} />
        </label>
        <label className={label}>
          How you will know it is done, one check per line
          <textarea name="acceptance" required rows={3} className={field} />
        </label>
        <label className={label}>
          Command that runs the tests
          <input name="test" placeholder="bun test" aria-describedby="test-hint" className={cx(field, 'font-mono')} />
          <span id="test-hint" className="text-small font-normal text-ink-2">
            Stint runs it itself to check the work. Leave it empty to use the one in this project's settings.
          </span>
        </label>
        <details data-testid="new-task-limits" className="rounded-[5px] border border-rule">
          <summary className="min-h-9 px-3 py-2 rounded-[5px] font-medium cursor-pointer hover:bg-panel-2">Limits</summary>
          <div className="flex flex-col gap-3 px-3 pb-3">
            <p className="text-small text-ink-2">Autopilot stops and asks you before the task goes past one. Leave a field empty for the default shown in it.</p>
            <div className="grid grid-cols-1 min-[440px]:grid-cols-2 gap-3">
              {LIMIT_FIELDS.map(({ k, label: text, hint, min, max, step }) => {
                const d = defaults?.[k];
                return (
                  <label key={k} className={label}>
                    {text}
                    <input
                      name={k}
                      type="number"
                      min={min}
                      max={max}
                      step={step}
                      inputMode={step < 1 ? 'decimal' : 'numeric'}
                      placeholder={d === undefined ? '' : d === null ? 'No limit' : k === 'usd' ? d.toFixed(2) : String(d)}
                      aria-describedby={`limit-${k}-hint`}
                      className={cx(field, 'tabular')}
                    />
                    <span id={`limit-${k}-hint`} className="text-small font-normal text-ink-2">
                      {hint}
                    </span>
                  </label>
                );
              })}
            </div>
            <Explain word="limit" />
          </div>
        </details>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2.5 min-h-6 font-medium">
            <input type="checkbox" name="sharpen" aria-describedby="sharpen-hint" />
            Sharpen it first
          </label>
          <span id="sharpen-hint" className="text-small text-ink-2">
            Before any agent starts, Stint asks the few questions whose answers change what gets built, and recommends an answer to each.
          </span>
        </div>
        {error ? (
          <p role="alert" className="text-red">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2 justify-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" type="submit">
            Create task
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Actions that need nothing from the router; the palette adds navigation and the open task's actions itself. */
export function usePaletteActions(extra: { newTask: () => void }): Action[] {
  const [sound, setSoundState] = useState(soundOn);
  const singleKeys = useSingleKeys();
  return useMemo(
    () => [
      { id: 'new', label: 'New task', key: 'n', cli: 'stint new "..."', group: 'go' as const, run: extra.newTask },
      { id: 'run-all', label: 'Run all planned tasks on autopilot', cli: 'stint run <task>', group: 'actions' as const, run: () => report(api.autopilotAll(true), 'Planned tasks are on autopilot') },
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
    [extra.newTask, sound, singleKeys],
  );
}
