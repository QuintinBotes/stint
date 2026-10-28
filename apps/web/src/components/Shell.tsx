import { Command } from 'cmdk';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ADAPTER_NAMES, carNumber } from '../agents';
import { type CostRow, type DemoStatus, type Health, type TaskCardData, api, daemonMessage } from '../api';
import { toast } from 'sonner';
import { localDate, money } from '../format';
import { useTasks } from '../hooks';
import { setSingleKeys, useSingleKeys } from '../shortcuts';
import { THEMES, THEME_NAMES, nextTheme, setTheme, useTheme } from '../theme';
import { enableDesktopNotifications, setSound, soundOn } from './Notifier';
import { StatusMenu } from './StatusMenu';
import { Button, cx } from './ui';

function startOfWeek(now = new Date()): string {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // Monday is the first day
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function useWeekCost(): number | null {
  const [rows, setRows] = useState<CostRow[] | null>(null);
  useEffect(() => {
    const load = () => void api.costs('day').then(setRows).catch(() => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (!rows) return null;
  const from = startOfWeek();
  return rows.filter((r) => r.key >= from).reduce((s, r) => s + (r.usd ?? 0), 0);
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

export function TopBar({ health, unreachable, onPalette }: { health: Health | null; unreachable: boolean; onPalette: () => void }) {
  const week = useWeekCost();
  const credits = useCredits();
  const theme = useTheme();
  const { pathname } = useLocation();
  const nav = [
    { to: '/', label: 'Timing', on: pathname === '/' || pathname.startsWith('/t/') },
    { to: '/factory', label: 'Standings', on: pathname.startsWith('/factory') },
    { to: '/skills', label: 'Setup sheet', on: pathname.startsWith('/skills') },
  ];
  return (
    <header className="shrink-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-6 py-3 border-b border-rule bg-ground">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 min-w-0">
        <Link to="/" className="text-[19px] leading-[28px] font-extrabold stretch-125 tracking-[-0.01em] no-underline">
          Stint
        </Link>
        <nav aria-label="Views" className="flex items-baseline gap-4 text-[14px]">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} aria-current={n.on ? 'page' : undefined} className={cx('pb-1 border-b-2 no-underline hover:text-ink', n.on ? 'font-bold border-ink text-ink' : 'border-transparent text-ink-2')}>
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] min-w-0">
        <button
          type="button"
          onClick={onPalette}
          data-testid="palette-button"
          className="inline-flex shrink-0 items-center gap-2 h-8 px-3 sm:min-w-[240px] rounded-[3px] border border-ink-3 font-mono text-[12px] text-ink-2 hover:border-ink"
        >
          <span aria-hidden="true" className="text-yellow font-bold">&gt;</span>
          <span>stint</span>
          <span className="sr-only">commands: search or run one</span>
          <span className="ml-auto pl-3 hidden sm:inline">⌘K</span>
        </button>
        <span className="hidden sm:inline text-ink-2 tabular whitespace-nowrap" title="Spend this week, Monday to Sunday, as metered by the daemon">
          This week <span className="text-ink font-bold">{week === null ? 'not known yet' : money({ usd: week })}</span>
        </span>
        <StatusMenu health={health} unreachable={unreachable} credits={credits} />
        <button
          type="button"
          onClick={() => setTheme(nextTheme(theme))}
          data-testid="theme-button"
          title="Switch the theme: pit wall (dark), timing sheet (light), stage (high contrast)"
          className="inline-flex shrink-0 items-center h-8 px-3 rounded-[3px] border border-ink-3 text-[12px] text-ink hover:border-ink whitespace-nowrap"
        >
          <span className="text-ink-2 mr-1">{'Theme: '}</span>
          {THEME_NAMES[theme]}
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
    <div data-testid="replay-strip" className="shrink-0 flex items-center gap-3 min-w-0 whitespace-nowrap px-4 sm:px-6 py-1 border-b border-rule bg-panel text-[12px] text-ink">
      <span className="font-semibold truncate">{r.live ? `Replay of a live run on ${localDate(r.recordedAt)}. No keys needed.` : 'Replay, hand-written. No keys needed.'}</span>
      {status ? (
        <span className="hidden sm:inline tabular text-ink-2">
          {status.playing ? (status.paused ? 'paused' : 'playing') : status.done ? 'finished' : 'stopped'}, {clock(status.at)} of {clock(status.total)}
        </span>
      ) : null}
      {status?.done ? (
        <Link to="/factory#any-harness" className="ml-auto shrink-0 text-ink underline underline-offset-2 hover:no-underline" data-testid="replay-close">
          Any harness, any model, one packet.
        </Link>
      ) : null}
    </div>
  );
}

/** `key` is the shortcut on the page, shown beside the command that does the same from a terminal. `group` places it. */
type Action = { id: string; label: string; cli: string; key?: string; group?: 'car' | 'prefs'; run: () => void };

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
  const live = health?.mode === 'replay' ? ' (needs a live daemon)' : '';
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
    { id: 'memory', label: 'Show the memory', key: 'm', cli: '', run: tab('memory') },
    { id: 'terminal', label: 'Open the terminal in the worktree', key: 't', cli: `cd .stint/worktrees/${id}-${card?.lastRun?.run ?? 'r1'}`, run: tab('terminal') },
    ...(run ? [{ id: 'stop', label: `Stop the run on track, ${run}`, key: '⌘.', cli: '', run: () => report(api.stopRun(id, run), `${run} stopped`) }] : []),
    // approving is offered only at the gate; asking for changes or rejecting works on any car still in the race
    ...(atGate ? [{ id: 'approve', label: 'Approve and merge', key: 'a', cli: `stint approve ${id}`, run: () => report(api.approve(id), `${id} merged`) }] : []),
    { id: 'changes', label: 'Request changes', key: 'r', cli: `stint reject ${id} --reason "..."`, run: () => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'changes' })) },
    { id: 'reject', label: 'Reject', key: 'x', cli: `stint reject ${id} --reason "..."`, run: () => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'reject' })) },
    { id: 'verify', label: 'Verify: the daemon runs the tests', cli: `stint verify ${id}`, run: () => report(api.verify(id), `${id}: tests run by the daemon`) },
    { id: 'hand', label: 'Change driver: hand to another agent', cli: `stint hand ${id} <agent>`, run: tab('packet') },
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
    { id: 'board', label: 'Timing, the board', cli: '/', run: () => navigate('/') },
    { id: 'factory', label: 'Standings', cli: '/factory', run: () => navigate('/factory') },
    { id: 'skills', label: 'Setup sheet, the skills', cli: 'stint skills list', run: () => navigate('/skills') },
    ...(tasks ?? []).map((c) => ({ id: `car-${c.task.id}`, label: `Car ${carNumber(c.task.id)}, ${c.task.title}`, cli: `stint open ${carNumber(c.task.id)}`, run: () => navigate(`/t/${c.task.id}`) })),
  ];
  const replay = health?.mode === 'replay' ? ' (needs a live daemon)' : '';
  const car = [...(taskId ? taskActions(taskId, tasks?.find((c) => c.task.id === taskId), navigate, health) : []), ...global.filter((a) => a.group !== 'prefs').map((a) => (a.id === 'run-all' ? { ...a, label: `${a.label}${replay}` } : a))];
  const prefs = global.filter((a) => a.group === 'prefs');
  const item = 'group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left text-ink data-[selected=true]:bg-panel-2 cursor-pointer';
  const heading = 'py-1 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-ink-2';
  const row = (a: Action) => (
    <Command.Item
      key={a.id}
      value={`${a.label} ${a.cli}`}
      onSelect={() => {
        a.run();
        onClose();
      }}
      className={item}
    >
      <span className="flex flex-col gap-1 min-w-0">
        <span className="text-[14px] leading-5 truncate">{a.label}</span>
        {a.cli ? <span className="font-mono text-[12px] leading-4 truncate text-ink-3 group-data-[selected=true]:text-ink-2">{a.cli}</span> : null}
      </span>
      <span className="font-mono text-[12px] text-ink-2 justify-self-end">{a.key ?? ''}</span>
    </Command.Item>
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[12vh] px-4" onMouseDown={onClose}>
      <Command
        label="Command line"
        className="w-full max-w-[640px] flex flex-col rounded-[4px] border border-rule-strong bg-panel shadow-[var(--shadow)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <label className="flex items-center gap-2 h-14 px-4 border-b-2 border-rule-strong focus-within:border-ink font-mono text-[14px]">
          <span aria-hidden="true" className="text-yellow font-bold">
            &gt;
          </span>
          <span aria-hidden="true">stint</span>
          <span className="sr-only">Type a command or what you want to do</span>
          <Command.Input autoFocus placeholder="Type a command or a task" className="flex-1 min-w-0 h-12 bg-transparent outline-none focus-visible:outline-none placeholder:text-ink-3" />
        </label>
        <Command.List className="max-h-[52vh] overflow-y-auto py-2">
          <Command.Empty className="px-4 py-4 text-ink-2">Nothing matches. Try verify, hand, or approve.</Command.Empty>
          <Command.Group heading={taskId ? `This car, ${carNumber(taskId)}` : 'Actions'} className={heading}>
            {car.map(row)}
          </Command.Group>
          <Command.Group heading="Go to" className={heading}>
            {go.map(row)}
          </Command.Group>
          <Command.Group heading="Preferences" className={heading}>
            {prefs.map(row)}
          </Command.Group>
        </Command.List>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-4 py-2 border-t border-rule text-[12px] text-ink-2">
          <span>Each command is what you would type in a terminal.</span>
          <span>Enter runs it, Escape closes</span>
        </div>
      </Command>
    </div>
  );
}

export function Dialog({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  useRestoreFocus(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[10vh] px-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal aria-label={title} className="w-full max-w-[520px] rounded-[4px] border border-rule-strong bg-ground p-5 shadow-[var(--shadow)]" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-[19px] leading-[24px] font-bold stretch-112 tracking-[-0.01em] mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const field = 'w-full rounded-[3px] border border-rule-strong bg-panel px-3 py-2 text-[14px] text-ink';
  const label = 'flex flex-col gap-2 text-[14px] font-bold';
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
          setError(null);
          api
            .createTask({ title: String(f.get('title')), goal: String(f.get('goal')), acceptance, ...(f.get('test') ? { testCommand: String(f.get('test')) } : {}) })
            .then((t) => {
              onClose();
              navigate(`/t/${t.id}`);
            })
            .catch((err: unknown) => setError(`The task was not created: ${err instanceof Error ? err.message : String(err)}`));
        }}
      >
        <p className="text-[12px] text-ink-2 -mt-2">A new car on the grid. It waits there until you send a driver out or put it on autopilot.</p>
        <label className={label}>
          Title
          <input name="title" required maxLength={120} className={field} />
        </label>
        <label className={label}>
          Goal
          <textarea name="goal" required rows={3} className={field} />
        </label>
        <label className={label}>
          Acceptance criteria, one per line
          <textarea name="acceptance" required rows={3} className={field} />
        </label>
        <label className={label}>
          Test command the daemon runs
          <input name="test" placeholder="bun test" className={cx(field, 'font-mono')} />
        </label>
        {error ? (
          <p role="alert" className="text-red text-[14px]">
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
      { id: 'new', label: 'New task', key: 'n', cli: 'stint new "..."', run: extra.newTask },
      { id: 'run-all', label: 'Run all planned tasks on autopilot', cli: 'stint run <task>', run: () => report(api.autopilotAll(true), 'Planned tasks are on autopilot') },
      {
        id: 'notifications',
        label: 'Turn on desktop notifications',
        cli: '',
        group: 'prefs' as const,
        run: () =>
          void enableDesktopNotifications().then((result) => {
            if (result === 'granted') toast.success('Desktop notifications are on. A run finishing or a task needing you will say so outside this window.');
            else if (result === 'denied') toast.error('Desktop notifications stay off: the browser refused permission.');
            else toast.error('This browser has no desktop notifications.');
          }),
      },
      ...THEMES.map((t) => ({ id: `theme-${t}`, label: `Switch to the ${THEME_NAMES[t].toLowerCase()} theme`, cli: '', group: 'prefs' as const, run: () => setTheme(t) })),
      {
        id: 'single-keys',
        label: singleKeys ? 'Turn single-key shortcuts off' : 'Turn single-key shortcuts on',
        cli: '',
        group: 'prefs' as const,
        run: () => {
          setSingleKeys(!singleKeys);
          toast.success(singleKeys ? 'Single-key shortcuts are off. Cmd+K and Cmd+. still work.' : 'Single-key shortcuts are on: n, d, m, a and the rest.');
        },
      },
      {
        id: 'sound',
        label: sound ? 'Turn sound off' : 'Turn sound on',
        cli: '',
        group: 'prefs' as const,
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
