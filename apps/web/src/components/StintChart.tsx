import type { Review, StintEvent } from '@stint-dev/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { agentOf, markColor } from '../agents';
import type { RunSummary } from '../api';
import { useWidth } from '../hooks';
import { type ChipTone, Swatch, cx } from './ui';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * The task's own clock, one reading per event, in event order. A replayed event carries its place in the story
 * (replayAt), so the chart shows the story's pace rather than the instant it was appended; an event without one
 * follows the last by the real time between them. Live tasks read real time from their first event.
 */
export function taskClock(events: StintEvent[]): { at: number[]; story: boolean; base: number } {
  const at: number[] = [];
  const story = events.some((e) => typeof e.payload.replayAt === 'number');
  const base = events[0] ? Date.parse(events[0].ts) : Date.now();
  events.forEach((e, i) => {
    const replayAt = e.payload.replayAt;
    if (typeof replayAt === 'number') at.push(replayAt);
    else if (i === 0) at.push(0);
    else at.push((at[i - 1] as number) + Math.max(0, Date.parse(e.ts) - Date.parse((events[i - 1] as StintEvent).ts)));
  });
  return { at, story, base };
}

/** A reading of the clock in words: m:ss of the story for a replay, the local time of day for a live task. */
export function clockLabel(ms: number, story: boolean, base: number, seconds = true): string {
  if (story) return `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
  return new Date(base + ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
}

/** The clock reading of the moment `asOf` names: the last event at or before it. Null is now. */
export function clockAt(events: StintEvent[], at: number[], asOf: string | null): number | null {
  if (!asOf) return null;
  let found: number | null = null;
  events.forEach((e, i) => {
    if (e.ts <= asOf) found = at[i] as number;
  });
  return found ?? (at[0] ?? 0) - 1;
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400].map((s) => s * 1000);

type Mark = { id: string; x: number; c: number; label: string; tone: ChipTone; title: string; kind: 'flag' | 'decision' | 'stewards' | 'learned' };

/**
 * Rows for labels so none covers another: each goes in the first row with room, reading right from its mark or, where
 * that is taken or runs off the edge, ending at it. A label with no room at all is not drawn, flag and all: a flag never
 * stands without its word, and screen readers still get it.
 */
export function rows<T extends { x: number; label: string }>(items: T[], widthPx: number, maxRows: number, charPx = 6.6, pad = 26): Array<T & { row: number; end: boolean }> {
  const taken: Array<Array<[number, number]>> = Array.from({ length: maxRows }, () => []);
  return [...items]
    .sort((a, b) => a.x - b.x)
    .map((it) => {
      const at = (it.x / 100) * widthPx;
      const w = it.label.length * charPx + pad;
      const spans: Array<{ end: boolean; l: number; r: number }> = [
        { end: false, l: at - 8, r: at + w },
        { end: true, l: at - w, r: at + 8 },
      ].filter((s) => s.l >= -8 && s.r <= widthPx + 8);
      for (let row = 0; row < maxRows; row++) {
        const span = spans.find((s) => (taken[row] as Array<[number, number]>).every(([l, r]) => s.r + 4 <= l || s.l >= r + 4));
        if (span) {
          (taken[row] as Array<[number, number]>).push([span.l, span.r]);
          return { ...it, row, end: span.end };
        }
      }
      return { ...it, row: -1, end: false };
    });
}

export type StintChartProps = {
  events: StintEvent[];
  runs: RunSummary[];
  review: Review | null;
  done: boolean;
  /** The moment the task view shows, as the URL keeps it; null is now. */
  asOf: string | null;
  /** The last event shown, when the moment was set on this chart: exact where several events share a timestamp. */
  atSeq?: number | null;
  onAsOf: (asOf: string | null, at?: number) => void;
  onOpenPacket: (name: string) => void;
  compact?: boolean;
};

/**
 * The stint chart, which is also the time scrubber: every stint as a bar in its team's livery, the pit stops between
 * them, the flags, the decisions and the spend, on the task's own clock. Dragging the clock moves the moment the whole
 * task view shows: race control, the diff, the pit board and memory rewind together.
 */
export function StintChart({ events, runs, review, done, asOf, atSeq = null, onAsOf, onOpenPacket, compact = false }: StintChartProps) {
  const { ref, width } = useWidth<HTMLDivElement>(900);
  const { at, story, base } = useMemo(() => taskClock(events), [events]);
  const live = runs.some((r) => !r.endedAt);
  // a live run keeps growing, so the chart's end follows the wall clock while one is on track
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live || story) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [live, story]);
  const first = at[0] ?? 0;
  const last = at.at(-1) ?? 0;
  const lastTs = events.at(-1) ? Date.parse((events.at(-1) as StintEvent).ts) : now;
  const end = live && !story ? Math.max(last, last + (now - lastTs)) : last;
  // a car still in the race has track ahead of it: hatched, not run yet
  const span = Math.max(1000, end - first);
  const ahead = done ? 0 : span * 0.08;
  const total = span + ahead;
  const x = (c: number) => Math.min(100, Math.max(0, ((c - first) / total) * 100));

  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const seqIndex = atSeq === null ? -1 : events.findIndex((e) => e.seq === atSeq);
  const fromUrl = seqIndex >= 0 ? (at[seqIndex] as number) : clockAt(events, at, asOf);
  const cursor = draft ?? fromUrl ?? end;
  // an asOf from elsewhere (memory, a link) replaces a drag that has settled
  useEffect(() => setDraft(null), [asOf, atSeq]);

  const model = useMemo(() => {
    const index = new Map(events.map((e, i) => [e.seq, i]));
    const c = (e: StintEvent) => at[index.get(e.seq) ?? 0] as number;
    const finished = new Map(events.filter((e) => e.type === 'run.finished' && e.run).map((e) => [e.run as string, e]));
    const bars = events
      .filter((e) => e.type === 'run.started' && e.run)
      .map((e) => {
        const run = e.run as string;
        const fin = finished.get(run);
        const agent = agentOf(e.adapter, str(e.payload.host), str(e.payload.model));
        const s = c(e);
        const f = fin ? c(fin) : end;
        const endedBy = fin ? str(fin.payload.endedBy) : 'running';
        const secs = Math.max(1, Math.round((f - s) / 1000));
        const dur = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
        const role = str(e.payload.role);
        const note =
          endedBy === 'killed'
            ? `stopped ${dur} in`
            : endedBy === 'failed'
              ? `failed after ${dur}`
              : endedBy === 'running'
                ? 'on track'
                : role === 'planner'
                  ? `plan, ${dur}`
                  : role === 'reviewer'
                    ? `review${str(e.payload.host) === 'ollama' ? ', offline' : ''}, ${dur}`
                    : e.payload.handoffFrom
                      ? `${dur} from ${str(e.payload.handoffFrom)}`
                      : dur;
        return { run, agent, s, f, endedBy, note, seq: e.seq };
      });
    const pits = events
      .filter((e) => e.type === 'handoff.created')
      .map((e) => ({ id: `p${e.seq}`, x: x(c(e)), c: c(e), name: str(e.payload.name), tokens: Number(e.payload.tokens) || 0 }));
    const marks: Mark[] = [];
    for (const e of events) {
      const p = e.payload;
      const m = (label: string, tone: ChipTone, kind: Mark['kind'], title: string) => marks.push({ id: `m${e.seq}`, x: x(c(e)), c: c(e), label, tone, kind, title });
      if (e.type === 'run.finished' && (p.endedBy === 'killed' || p.endedBy === 'failed')) m(p.endedBy === 'killed' ? 'Stopped' : 'Failed', 'bad', 'flag', `${e.run} ${str(p.endedBy)}`);
      else if (e.type === 'verification.ran') m(p.status === 'green' ? `${Number(p.passed)} passed` : `${Number(p.failed)} failed`, p.status === 'green' ? 'good' : 'bad', 'flag', `Verification by the daemon: ${Number(p.passed)} passed, ${Number(p.failed)} failed`);
      else if (e.type === 'review.recorded') m(`Review: ${str(p.verdict).replace('_', ' ')}`, p.verdict === 'block' ? 'bad' : p.verdict === 'approve' ? 'good' : 'warn', 'flag', 'Review recorded');
      else if (e.type === 'approval.requested') m('Your call', 'warn', 'flag', 'Approval requested: waiting at the gate');
      else if (e.type === 'approval.rejected') m('Rejected', 'bad', 'flag', `Rejected: ${str(p.reason)}`);
      else if (e.type === 'merge.completed') m('Merged', 'merged', 'flag', `Merged as ${str(p.commit).slice(0, 7)}`);
      else if (e.type === 'decision.recorded') m(str(p.id) || 'Decision', 'neutral', 'decision', str(p.text));
      else if (e.type === 'skill.approved') m('Learned', 'learned', 'learned', `Skill learned: ${str(p.id ?? p.skill)}`);
      if (e.type === 'review.recorded' && Number(p.contradictions) > 0) {
        const against = (review?.findings ?? []).filter((f) => f.contradictsDecision).map((f) => `${f.id} vs ${f.contradictsDecision}`);
        marks.push({ id: `s${e.seq}`, x: x(c(e)), c: c(e), label: against[0] ?? `${Number(p.contradictions)} to the stewards`, tone: 'warn', kind: 'stewards', title: 'A finding against a decision, sent to the stewards' });
      }
    }
    // the spend, as it stood after each stint, from what each run cost
    const cost = new Map(runs.map((r) => [r.run, r.cost?.usd ?? 0]));
    const spend: Array<{ c: number; usd: number }> = [];
    let sum = 0;
    for (const b of [...bars].sort((a, z) => a.f - z.f)) {
      if (b.endedBy === 'running') continue;
      sum += cost.get(b.run) ?? 0;
      spend.push({ c: b.f, usd: sum });
    }
    return { bars, pits, marks, spend, sum };
  }, [events, at, end, runs, review, total]);

  const { bars, pits, marks, spend, sum } = model;
  const teams = new Set(bars.map((b) => b.agent.mark)).size;
  const spentAt = [...spend].reverse().find((s) => s.c <= cursor)?.usd ?? 0;
  const step = STEPS.find((s) => total / s <= Math.max(3, Math.floor(width / 110))) ?? 86_400_000;
  const ticks: number[] = [];
  // ticks on round readings: of the story for a replay, of the wall clock for a live task
  const offset = story ? 0 : base;
  for (let t = Math.ceil((first + offset) / step) * step - offset; t <= first + total; t += step) ticks.push(t);
  const label = (ms: number) => clockLabel(ms, story, base, step < 60_000 || story);
  // flags and decisions share one lane; a label with no room is read out but not drawn
  const flagRows = rows(marks, width, 2);
  const pitRows = rows(pits.map((p) => ({ ...p, label: p.name })), width, 1, 7, 4);
  const cursorX = x(cursor);
  const atEnd = draft === null && asOf === null;
  const rewound = !atEnd;

  const scrub = (v: number) => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (v >= end) return onAsOf(null);
      // the last event at or before the clock reading: its time for the memory graph, its place for race control
      let last = -1;
      events.forEach((_, i) => {
        if ((at[i] as number) <= v) last = i;
      });
      const e = events[last];
      if (e) onAsOf(e.ts, e.seq);
      else onAsOf(new Date(Date.parse(events[0]?.ts ?? new Date().toISOString()) - 1).toISOString(), 0);
    }, 120);
  };

  // a car with no stints has nothing to scrub: one line instead of empty lanes and a clock
  if (bars.length === 0)
    return (
      <section aria-label="Stint chart" data-testid="stint-chart" data-rewound={rewound} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[4px] border border-rule bg-panel px-4 py-3">
        <h2 className="text-[14px] leading-5 font-bold">Stint chart</h2>
        <span className="text-[14px] text-ink-2">{done ? 'No stints were recorded on this car.' : 'No driver has gone out yet. Each stint appears here on the race clock.'}</span>
      </section>
    );

  const lane = 'relative border-t border-rule overflow-hidden';
  const cursorLine = <div aria-hidden="true" data-testid="stint-cursor" className="absolute top-0 bottom-0 w-0.5 bg-ink pointer-events-none" style={{ left: `calc(${cursorX}% - 1px)` }} />;
  const head = compact ? 'grid-cols-[56px_minmax(0,1fr)]' : 'grid-cols-[64px_minmax(0,1fr)] sm:grid-cols-[88px_minmax(0,1fr)]';
  const laneName = 'text-[12px] text-ink-2';

  return (
    <section aria-label="Stint chart and race clock" data-testid="stint-chart" data-rewound={rewound} className="rounded-[4px] border border-rule bg-panel px-3 sm:px-4 pt-4 pb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <h2 className="text-[19px] leading-6 font-bold stretch-112">Stint chart</h2>
        <span className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-2">
          <span>
            Race clock{' '}
            <span className="tabular text-ink font-bold" data-testid="stint-clock">
              {label(cursor)}
            </span>
            {rewound ? '' : ', now'}
          </span>
          <span>
            Spent <span className="tabular text-ink font-bold">${(atEnd ? sum : spentAt).toFixed(2)}</span>
          </span>
          <span>
            {bars.length} stint{bars.length === 1 ? '' : 's'}, {teams} team{teams === 1 ? '' : 's'}, {pits.length} pit stop{pits.length === 1 ? '' : 's'}, no transcript carried
          </span>
        </span>
      </div>
      <div ref={ref} className={cx('grid items-stretch', head)}>
        <span />
        <div aria-hidden="true" className="relative h-5 text-[12px] text-ink-3 tabular overflow-hidden">
          {ticks.map((t) => (
            <span key={t} className="absolute whitespace-nowrap" style={{ left: `${x(t)}%` }}>
              {label(t)}
            </span>
          ))}
        </div>

        <span className={cx(laneName, 'pt-5')}>Stints</span>
        <div className={cx(lane, 'h-16')}>
          <div aria-hidden="true" className="absolute top-[31px] left-0 right-0 border-t border-dashed border-rule-strong" />
          {bars.map((b, i) => {
            const next = bars[i + 1];
            const played = Math.max(0, Math.min(b.f, cursor) - b.s);
            const room = (next ? x(next.s) : 100) - x(b.s);
            return (
              <div key={b.run} data-testid="stint-bar" data-run={b.run} title={`${b.agent.name} ${b.run}: ${b.note}`}>
                <div aria-hidden="true" className="absolute top-[18px] h-[34px] rounded-[3px] border border-dashed border-rule-strong box-border" style={{ left: `${x(b.s)}%`, width: `max(4px, ${x(b.f) - x(b.s)}%)` }} />
                <div
                  aria-hidden="true"
                  className={cx('absolute top-[18px] h-[34px] rounded-[3px]', b.endedBy === 'running' && 'live-spine')}
                  style={{ left: `${x(b.s)}%`, width: `max(${played > 0 ? 4 : 0}px, ${(played / total) * 100}%)`, background: markColor[b.agent.mark] }}
                />
                {(b.endedBy === 'killed' || b.endedBy === 'failed') && cursor >= b.f ? <div aria-hidden="true" className="absolute top-[18px] h-[34px] w-1.5 bg-[var(--sw-red)]" style={{ left: `calc(${x(b.f)}% - 6px)` }} /> : null}
                <span
                  className={cx('absolute top-0 text-[14px] leading-4 whitespace-nowrap overflow-hidden text-ellipsis', cursor < b.s && 'text-ink-3')}
                  style={{ left: `${x(b.s)}%`, maxWidth: `calc(${room}% - 4px)` }}
                >
                  <span className="font-extrabold stretch-75 tracking-[0.03em]">{b.agent.code}</span> <span className={cx('text-[12px]', cursor < b.s ? 'text-ink-3' : b.endedBy === 'killed' || b.endedBy === 'failed' ? 'text-ink font-bold' : 'text-ink-2')}>{b.note}</span>
                  <span className="sr-only">, {b.agent.name} {b.run}</span>
                </span>
              </div>
            );
          })}
          {pitRows.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid="stint-pit"
              onClick={() => onOpenPacket(p.name)}
              title={`Pit stop: packet ${p.name}, ${p.tokens} tokens. Open the packet`}
              className={cx('absolute top-[52px] text-[12px] leading-3 font-bold stretch-75 text-ink-2 whitespace-nowrap hover:text-ink hover:underline', p.end && '-translate-x-full', cursor < p.c && 'invisible')}
              style={{ left: `${p.x}%` }}
            >
              {p.name}
              <span className="sr-only">, {p.tokens} tokens, open the packet</span>
            </button>
          ))}
          {cursorLine}
        </div>

        {compact ? null : (
          <>
            <span className={cx(laneName, 'pt-2')}>Flags</span>
            <div className={cx(lane, 'h-12 border-b')}>
              {flagRows.map((m) =>
                m.kind === 'flag' ? (
                  <span
                    key={m.id}
                    data-testid="stint-flag"
                    title={m.title}
                    className={cx('absolute inline-flex items-center gap-1 text-[12px] leading-4 whitespace-nowrap', m.end && 'flex-row-reverse -translate-x-full', m.row < 0 && 'sr-only', cursor < m.c && 'invisible')}
                    style={{ left: m.end ? `calc(${m.x}% + 7px)` : `calc(${m.x}% - 7px)`, top: m.row === 1 ? 26 : 6 }}
                  >
                    <Swatch tone={m.tone} />
                    {m.label}
                  </span>
                ) : (
                  <span
                    key={m.id}
                    data-testid="stint-mark"
                    title={m.title}
                    className={cx(
                      'absolute text-[12px] leading-4 font-bold whitespace-nowrap',
                      m.kind === 'stewards' ? 'text-yellow' : m.kind === 'learned' ? 'text-purple' : 'text-ink-2',
                      m.row < 0 && 'sr-only',
                      cursor < m.c && 'invisible',
                    )}
                    style={{ left: `${m.x}%`, top: m.row === 1 ? 26 : 6, ...(m.end ? { transform: 'translateX(-100%)' } : {}) }}
                  >
                    {m.label}
                  </span>
                ),
              )}
              {cursorLine}
            </div>
          </>
        )}

        <label htmlFor="stint-scrubber" className="pt-2 text-[12px] text-ink-2">
          Clock<span className="sr-only">: drag it and race control, the diff, the pit board and memory show the task at that moment</span>
        </label>
        <div className="pt-2">
          <input
            id="stint-scrubber"
            data-testid="stint-scrubber"
            type="range"
            min={first}
            max={end}
            step={Math.max(1, Math.round((end - first) / 600))}
            value={Math.min(end, Math.max(first, cursor))}
            aria-valuetext={`${label(cursor)}${rewound ? '' : ', now'}`}
            onChange={(e) => scrub(Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 mt-1 text-[12px] text-ink-2 empty:hidden">
        <span className="flex items-center gap-3 empty:hidden">
          {rewound ? (
            <button
              type="button"
              data-testid="stint-latest"
              onClick={() => {
                setDraft(null);
                onAsOf(null);
              }}
              className="h-7 px-2 rounded-[3px] border border-ink-3 text-[12px] text-ink hover:border-ink"
            >
              Back to the latest
            </button>
          ) : null}
        </span>
      </div>
    </section>
  );
}
