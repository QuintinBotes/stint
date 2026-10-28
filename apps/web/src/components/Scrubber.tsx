import type { StintEvent } from '@stint-dev/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState } from './ui';

/**
 * The task's own clock, one reading per event, in event order. A replayed event carries its place in the story
 * (replayAt), so the clock shows the story's pace rather than the instant it was appended; an event without one
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

export type ScrubberProps = {
  events: StintEvent[];
  /** A run is going, so the clock's end follows the wall clock. */
  live: boolean;
  /** The moment the task view shows, as the URL keeps it; null is now. */
  asOf: string | null;
  /** The last event shown, when the moment was set here: exact where several events share a timestamp. */
  atSeq: number | null;
  /** The moment in the task's words, as the task view names it. */
  reading: string | null;
  onAsOf: (asOf: string | null, at?: number) => void;
};

/**
 * The task view's one clock, at the head of memory. Dragging it moves the moment (the URL's asOf and at) the whole view
 * shows: the runs, the revisions, the packet and memory rewind together, and Now returns to the latest.
 */
export function Scrubber({ events, live, asOf, atSeq, reading, onAsOf }: ScrubberProps) {
  const { at, story, base } = useMemo(() => taskClock(events), [events]);
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

  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const seqIndex = atSeq === null ? -1 : events.findIndex((e) => e.seq === atSeq);
  const fromUrl = seqIndex >= 0 ? (at[seqIndex] as number) : clockAt(events, at, asOf);
  const cursor = draft ?? fromUrl ?? end;
  // an asOf from elsewhere (a link, a memory node) replaces a drag that has settled
  useEffect(() => setDraft(null), [asOf, atSeq]);
  const rewound = draft !== null || asOf !== null;
  const label = (ms: number) => clockLabel(ms, story, base);
  const shown = draft !== null ? label(draft) : asOf ? (reading ?? label(cursor)) : `${label(end)}, now`;

  const scrub = (v: number) => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (v >= end) return onAsOf(null);
      // the last event at or before the reading: its time for memory, its place for the rail
      let lastShown = -1;
      events.forEach((_, i) => {
        if ((at[i] as number) <= v) lastShown = i;
      });
      const e = events[lastShown];
      if (e) onAsOf(e.ts, e.seq);
      else onAsOf(new Date(Date.parse(events[0]?.ts ?? new Date().toISOString()) - 1).toISOString(), 0);
    }, 120);
  };

  if (events.length === 0) return <EmptyState testId="empty-clock">The clock appears here with the task's first event. Drag it to see the task at any moment.</EmptyState>;
  return (
    <div data-testid="scrubber-block" data-rewound={rewound} className="flex flex-col gap-1.5">
      <label htmlFor="asof" className="flex items-baseline justify-between gap-2">
        <span className="text-small font-medium">Rewind</span>
        <span className="font-mono text-code" data-testid="memory-asof">
          {shown}
        </span>
      </label>
      <span id="asof-hint" className="sr-only">
        Drag to see the runs, the revisions, the packet and memory as they were at that moment.
      </span>
      <div className="flex items-center gap-3">
        <input
          id="asof"
          data-testid="scrubber"
          type="range"
          min={first}
          max={end}
          step={Math.max(1, Math.round((end - first) / 600))}
          value={Math.min(end, Math.max(first, cursor))}
          aria-valuetext={shown}
          aria-describedby="asof-hint"
          onChange={(e) => scrub(Number(e.target.value))}
          className="flex-1 min-w-0"
        />
        <Button
          className="h-8 px-2.5 text-small"
          disabled={!rewound}
          data-testid="scrub-now"
          onClick={() => {
            setDraft(null);
            onAsOf(null);
          }}
        >
          Now
        </Button>
      </div>
    </div>
  );
}
