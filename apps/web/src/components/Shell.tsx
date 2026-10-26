import { Command } from 'cmdk';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { type CostRow, type DemoStatus, type Health, api } from '../api';
import { localDate, money } from '../format';
import { useTasks } from '../hooks';
import { THEMES, type ThemeChoice } from '../theme';
import { Button, Kbd, StatusChip, cx } from './ui';

const ADAPTER_NAMES: Record<string, string> = {
  'muse-code': 'Muse Code',
  'claude-code': 'Claude Code harness',
  'openai-compatible': 'Plan and review hosts',
  replay: 'Replay',
};

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

export function TopBar({ health, theme, setTheme, onPalette }: { health: Health | null; theme: ThemeChoice; setTheme: (t: ThemeChoice) => void; onPalette: () => void }) {
  const week = useWeekCost();
  return (
    <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-line bg-surface">
      <Link to="/" className="text-[15px] font-semibold tracking-[-0.01em]">
        Stint
      </Link>
      <nav className="hidden md:flex items-center gap-3 text-muted text-[13px]">
        <Link to="/" className="hover:text-ink">
          Board
        </Link>
        <Link to="/factory" className="hover:text-ink">
          Factory
        </Link>
        <Link to="/skills" className="hover:text-ink">
          Skills
        </Link>
      </nav>
      <button type="button" onClick={onPalette} className="ml-2 flex items-center gap-2 h-8 px-2 rounded-md border border-line text-muted hover:text-ink">
        <span className="hidden sm:inline">Commands</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-2 min-w-0">
        <span className="hidden sm:inline text-[12px] text-muted tabular" title="Spend this week, Monday to Sunday, as metered by the daemon">
          This week {week === null ? 'not known yet' : money({ usd: week })}
        </span>
        <div className="hidden lg:flex items-center gap-1.5" data-testid="health-chips">
          {health && health.adapters.filter((a) => a.id !== 'replay').every((a) => a.capability.level !== 'supported') ? (
            <>
              {health.mode === 'replay' ? <StatusChip label="Replay" tone="good" /> : null}
              <StatusChip label="No live agents configured" tone="neutral" />
            </>
          ) : health ? (
            health.adapters.map((a) => (
              <StatusChip
                key={a.id}
                label={`${ADAPTER_NAMES[a.id] ?? a.id}${a.capability.level === 'supported' ? (a.gate === 'none' ? '' : `, gate ${a.gate}`) : ', unavailable'}`}
                tone={a.capability.level === 'supported' ? 'good' : 'neutral'}
              />
            ))
          ) : (
            <StatusChip label="daemon not reachable" tone="bad" />
          )}
        </div>
        <label className="sr-only" htmlFor="theme">
          Theme
        </label>
        <select
          id="theme"
          data-testid="theme"
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeChoice)}
          className="h-8 rounded-md border border-line bg-raised px-2 text-[12px] text-ink"
        >
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t[0]?.toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
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
    <div data-testid="replay-strip" className="h-7 shrink-0 flex items-center gap-3 px-4 border-b border-line bg-sunken text-[12px] text-muted">
      <span className="text-ink">{r.live ? `Replay of a live run on ${localDate(r.recordedAt)}` : 'Replay, hand-written'}</span>
      {status ? (
        <span className="tabular">
          {status.playing ? (status.paused ? 'paused' : 'playing') : status.done ? 'finished' : 'stopped'}, {clock(status.at)} of {clock(status.total)}
        </span>
      ) : null}
    </div>
  );
}

type Action = { id: string; label: string; cli: string; arrivesIn?: string; run?: () => void };

export function Palette({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: Action[] }) {
  const { data: tasks } = useTasks();
  const navigate = useNavigate();
  if (!open) return null;
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
          <Command.Group heading="Actions" className="text-[11px] text-faint px-2 [&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:py-1">
            {actions.map((a) => (
              <Command.Item
                key={a.id}
                value={`${a.label} ${a.cli}`}
                disabled={!a.run}
                onSelect={() => {
                  a.run?.();
                  onClose();
                }}
                className="flex items-center justify-between gap-3 px-2 h-9 rounded-md text-[13px] text-ink data-[selected=true]:bg-accent-tint data-[disabled=true]:text-faint"
              >
                <span>{a.label}</span>
                <span className="font-mono text-[11.5px] text-faint">{a.arrivesIn ? `arrives in ${a.arrivesIn}` : a.cli}</span>
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

export function usePaletteActions(extra: { newTask: () => void; setTheme: (t: ThemeChoice) => void; theme: ThemeChoice }): Action[] {
  return useMemo(
    () => [
      { id: 'new', label: 'New task', cli: 'stint new', run: extra.newTask },
      { id: 'assign', label: 'Assign to an agent', cli: 'stint assign', arrivesIn: 'R-009' },
      { id: 'hand', label: 'Hand to another agent', cli: 'stint hand', arrivesIn: 'R-012' },
      { id: 'verify', label: 'Verify (the daemon runs the tests)', cli: 'stint verify', arrivesIn: 'R-016' },
      { id: 'approve', label: 'Approve and merge', cli: 'stint approve', arrivesIn: 'R-017' },
      { id: 'terminal', label: 'Open the terminal', cli: 'stint shell', arrivesIn: 'R-008' },
      {
        id: 'theme',
        label: `Switch theme (now ${extra.theme})`,
        cli: 'theme',
        run: () => extra.setTheme(THEMES[(THEMES.indexOf(extra.theme) + 1) % THEMES.length] as ThemeChoice),
      },
    ],
    [extra.newTask, extra.setTheme, extra.theme],
  );
}
