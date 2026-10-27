import { Command } from 'cmdk';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ADAPTER_NAMES, hostName, modelName } from '../agents';
import { type CostRow, DaemonError, type DemoStatus, type Health, type ModelHealth, type TaskCardData, api } from '../api';
import { toast } from 'sonner';
import { localDate, money } from '../format';
import { useTasks } from '../hooks';
import { enableDesktopNotifications, setSound, soundOn } from './Notifier';
import { StatusMenu } from './StatusMenu';
import { Button, Kbd, StatusChip, cx } from './ui';

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

/** The Meta models that can answer right now, one chip each; the rest wait for a key and say why on hover. */
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
  const { pathname } = useLocation();
  const task = /^\/t\/(T-\d+)/.exec(pathname)?.[1] ?? null;
  const nav = [
    { to: '/', label: 'Board', on: pathname === '/' || pathname.startsWith('/t/') },
    { to: '/factory', label: 'Factory', on: pathname.startsWith('/factory') },
    { to: '/skills', label: 'Skills', on: pathname.startsWith('/skills') },
  ];
  return (
    <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-line bg-surface">
      <nav aria-label="Where you are" className="flex shrink-0 items-center gap-2 text-[13px]">
        <Link to="/" className="text-[15px] font-semibold tracking-[-0.01em]">
          Stint
        </Link>
        {health?.repo ? (
          <>
            {/* on a phone the task id matters more; the repo is in the status panel */}
            <span aria-hidden className="hidden sm:inline text-faint">/</span>
            <span className="hidden sm:inline text-muted whitespace-nowrap" data-testid="repo-name">
              {health.repo}
            </span>
          </>
        ) : null}
        {task ? (
          <>
            <span aria-hidden className="text-faint">/</span>
            <span className="font-mono text-muted">{task}</span>
          </>
        ) : null}
      </nav>
      <nav aria-label="Pages" className="hidden md:flex items-center gap-1 text-[13px] ml-2">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} aria-current={n.on ? 'page' : undefined} className={cx('h-7 px-2.5 inline-flex items-center rounded-md', n.on ? 'bg-raised text-ink font-medium' : 'text-muted hover:text-ink')}>
            {n.label}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        onClick={onPalette}
        className="ml-2 flex shrink-0 items-center justify-between gap-4 h-8 w-[240px] max-w-[30vw] px-2.5 rounded-md border border-line bg-raised text-faint hover:text-muted hover:border-line-strong"
      >
        <span className="sr-only sm:not-sr-only text-[13px] truncate whitespace-nowrap">Search or run a command</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-3 min-w-0">
        <span className="hidden sm:inline text-[12px] text-muted tabular whitespace-nowrap" title="Spend this week, Monday to Sunday, as metered by the daemon">
          This week <span className="text-ink font-semibold">{week === null ? 'not known yet' : money({ usd: week })}</span>
        </span>
        <StatusMenu health={health} unreachable={unreachable} credits={credits} />
      </div>
    </header>
  );
}

export function ReplayStrip({ health }: { health: Health | null }) {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const replaying = health?.mode === 'replay';
  useEffect(() => {
    if (!replaying) return;
    const load = () => void api.demoStatus().then(setStatus).catch(() => undefined);
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [replaying]);
  if (!replaying || !health?.replay) return null;
  const r = health.replay;
  const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
  return (
    <div data-testid="replay-strip" className="h-8 shrink-0 flex items-center gap-3 px-4 border-b border-accent/30 bg-accent-tint text-[12px] text-ink">
      <span className="font-medium">{r.live ? `Replay of a live run on ${localDate(r.recordedAt)}. No keys needed.` : 'Replay, hand-written. No keys needed.'}</span>
      {status ? (
        <span className="tabular text-muted">
          {status.playing ? (status.paused ? 'paused' : 'playing') : status.done ? 'finished' : 'stopped'}, {clock(status.at)} of {clock(status.total)}
        </span>
      ) : null}
      {status?.done ? (
        <Link to="/factory#any-harness" className="ml-auto text-ink hover:text-accent" data-testid="replay-close">
          Any harness, any model, one packet.
        </Link>
      ) : null}
    </div>
  );
}

/** `key` is the shortcut on the page, shown beside the command that does the same from a terminal. */
type Action = { id: string; label: string; cli: string; key?: string; run: () => void };

/** What a daemon call said, as a toast: the daemon's own message when it refuses. */
function report(promise: Promise<unknown>, done: string): void {
  promise.then(() => toast.success(done)).catch((e: unknown) => toast.error(e instanceof DaemonError ? `${e.error.message}${e.error.hint && typeof e.error.hint === 'string' ? `: ${e.error.hint}` : ''}` : String(e)));
}

/** Actions on the task that is open, each with the command that does the same from a terminal; a closed task only offers its views. */
function taskActions(id: string, card: TaskCardData | undefined, navigate: (to: string) => void, health: Health | null): Action[] {
  const tab = (t: string) => () => navigate(`/t/${id}?tab=${t}`);
  const closed = card ? ['approved', 'done', 'rejected', 'abandoned'].includes(card.task.status) : false;
  const onAutopilot = !!card?.autopilot?.on;
  const running = !!card?.lastRun && !card.lastRun.endedAt;
  const views = new Set(['terminal', 'packet', 'diff']);
  // one action per agent that can build now; none while a run is live, since a task holds one run at a time
  const assign: Action[] = running
    ? []
    : (health?.adapters ?? [])
        .filter((a) => a.id !== 'replay' && a.capability.level === 'supported' && a.roles.includes('implementer'))
        .map((a) => ({ id: `assign-${a.id}`, label: `Assign to ${ADAPTER_NAMES[a.id] ?? a.id}`, cli: `stint assign ${id} ${a.id}`, run: () => report(api.assign(id, a.id), `${id}: ${ADAPTER_NAMES[a.id] ?? a.id} started`) }));
  const base = card?.task.baseCommit?.slice(0, 7) ?? 'main';
  return [
    ...assign,
    { id: 'verify', label: 'Verify: the daemon runs the tests', cli: `stint verify ${id}`, run: () => report(api.verify(id), `${id}: tests run by the daemon`) },
    { id: 'autopilot-on', label: 'Put on autopilot', cli: `stint run ${id}`, run: () => report(api.autopilot(id, true), `${id} is on autopilot`) },
    { id: 'autopilot-off', label: 'Take off autopilot', cli: `stint run ${id} --stop`, run: () => report(api.autopilot(id, false), `${id} is off autopilot`) },
    { id: 'hand', label: 'Hand to another agent', cli: `stint hand ${id} <agent>`, run: tab('packet') },
    { id: 'approve', label: 'Approve and merge', cli: `stint approve ${id}`, run: () => report(api.approve(id), `${id} merged`) },
    { id: 'changes', label: 'Request changes', cli: `stint reject ${id} --reason "..."`, run: () => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'changes' })) },
    { id: 'reject', label: 'Reject', cli: `stint reject ${id} --reason "..."`, run: () => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'reject' })) },
    { id: 'terminal', label: 'Open the terminal in the worktree', key: 't', cli: `cd .stint/worktrees/${id}-${card?.lastRun?.run ?? 'r1'}`, run: tab('terminal') },
    { id: 'packet', label: 'Show the packet', cli: `stint packet ${id} --as prompt`, run: tab('packet') },
    { id: 'diff', label: 'Show the diff', key: 'd', cli: `git diff ${base}..stint/${id}`, run: tab('diff') },
  ].filter((a) => (closed ? views.has(a.id) : a.id !== (onAutopilot ? 'autopilot-on' : 'autopilot-off')));
}

export function Palette({ open, onClose, actions: global, health }: { open: boolean; onClose: () => void; actions: Action[]; health: Health | null }) {
  const { data: tasks } = useTasks();
  const navigate = useNavigate();
  const location = useLocation();
  if (!open) return null;
  const taskId = /^\/t\/(T-\d+)/.exec(location.pathname)?.[1] ?? null;
  const go: Action[] = [
    { id: 'board', label: 'Go to the board', cli: '/', run: () => navigate('/') },
    { id: 'factory', label: 'Go to the Factory', cli: '/factory', run: () => navigate('/factory') },
    { id: 'skills', label: 'Go to Skills', cli: 'stint skills list', run: () => navigate('/skills') },
  ];
  const actions = [...(taskId ? taskActions(taskId, tasks?.find((c) => c.task.id === taskId), navigate, health) : []), ...global, ...go];
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[12vh] px-4" onMouseDown={onClose}>
      <Command
        label="Commands"
        className="w-full max-w-[560px] rounded-lg border border-line-strong bg-raised shadow-[var(--shadow-overlay)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <Command.Input autoFocus placeholder="Type a command or a task" className="w-full h-11 px-4 bg-transparent border-b border-line outline-none text-[13px]" />
        <Command.List className="max-h-[50vh] overflow-y-auto p-1">
          <Command.Empty className="px-3 py-4 text-faint">Nothing matches.</Command.Empty>
          <Command.Group heading={taskId ? `On ${taskId}, and everywhere` : 'Actions'} className="text-[11px] text-faint px-2 [&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:py-1">
            {actions.map((a) => (
              <Command.Item
                key={a.id}
                value={`${a.label} ${a.cli}`}
                onSelect={() => {
                  a.run();
                  onClose();
                }}
                className="flex items-center justify-between gap-3 px-2 h-9 rounded-md text-[13px] text-ink data-[selected=true]:bg-accent-tint"
              >
                <span>{a.label}</span>
                <span className="flex min-w-0 items-center gap-2">
                  {a.key ? <Kbd>{a.key}</Kbd> : null}
                  <span className="font-mono text-[11.5px] text-faint truncate">{a.cli}</span>
                </span>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Jump to task" className="text-[11px] text-faint px-2 [&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:py-1">
            {(tasks ?? []).map((c) => (
              <Command.Item
                key={c.task.id}
                value={`${c.task.id} ${c.task.title}`}
                onSelect={() => {
                  navigate(`/t/${c.task.id}`);
                  onClose();
                }}
                className="flex items-center gap-3 px-2 h-9 rounded-md text-[13px] text-ink data-[selected=true]:bg-accent-tint"
              >
                <span className="font-mono text-faint">{c.task.id}</span>
                <span className="truncate">{c.task.title}</span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

export function Dialog({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[10vh] px-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal aria-label={title} className="w-full max-w-[520px] rounded-lg border border-line-strong bg-raised p-5 shadow-[var(--shadow-overlay)]" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-semibold mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const field = 'w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px]';
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
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
        }}
      >
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Title
          <input name="title" required maxLength={120} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Goal
          <textarea name="goal" required rows={3} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Acceptance criteria, one per line
          <textarea name="acceptance" required rows={3} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Test command the daemon runs
          <input name="test" placeholder="bun test" className={cx(field, 'font-mono')} />
        </label>
        {error ? (
          <p role="alert" className="text-bad text-[12px]">
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
  return useMemo(
    () => [
      { id: 'new', label: 'New task', cli: 'stint new "..."', run: extra.newTask },
      { id: 'run-all', label: 'Run all planned tasks on autopilot', cli: 'stint run <task>', run: () => report(api.autopilotAll(true), 'Planned tasks are on autopilot') },
      {
        id: 'notifications',
        label: 'Turn on desktop notifications',
        cli: '',
        run: () =>
          void enableDesktopNotifications().then((result) => {
            if (result === 'granted') toast.success('Desktop notifications are on. A run finishing or a task needing you will say so outside this window.');
            else if (result === 'denied') toast.error('Desktop notifications stay off: the browser refused permission.');
            else toast.error('This browser has no desktop notifications.');
          }),
      },
      {
        id: 'sound',
        label: sound ? 'Turn sound off' : 'Turn sound on',
        cli: '',
        run: () => {
          setSound(!sound);
          setSoundState(!sound);
          toast.success(sound ? 'The needs-you sound is off.' : 'The needs-you sound is on.');
        },
      },
    ],
    [extra.newTask, sound],
  );
}
