import type { StintEvent } from '@stint-dev/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Health, type TaskBundle, type TaskCardData, api, subscribe } from './api';

export type Loadable<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loadable<T> & { setData: (d: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // the effect reruns on the caller's deps
  useEffect(() => {
    let live = true;
    load()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  return { data, error, loading, reload, setData };
}

/** Calls `fn` at most once per `ms`, trailing, so a burst of events causes one refetch. */
function useTrailing(fn: () => void, ms: number): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current();
    }, ms);
  }, [ms]);
}

export function useHealth(): Loadable<Health> {
  const h = useLoad(api.health, []);
  const { reload } = h;
  useEffect(() => {
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);
  return h;
}

/** The board: refetched when anything happens on any task. */
export function useTasks(): Loadable<TaskCardData[]> {
  const t = useLoad(api.tasks, []);
  const refresh = useTrailing(t.reload, 250);
  useEffect(() => subscribe('/api/stream', refresh, refresh), [refresh]);
  return t;
}

/** One task's bundle (task, plan, packet, review, verification, runs, cost), refetched as its events arrive. */
export function useTask(id: string): Loadable<TaskBundle> {
  const t = useLoad(() => api.task(id), [id]);
  const refresh = useTrailing(t.reload, 200);
  useEffect(() => subscribe(`/api/tasks/${id}/stream`, refresh, refresh), [id, refresh]);
  return t;
}

/** The task's event log, live: the initial read, then SSE with Last-Event-ID resume, then a 1 s poll if SSE fails. */
export function useEvents(id: string): { events: StintEvent[]; error: string | null } {
  const [events, setEvents] = useState<StintEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  useEffect(() => {
    let live = true;
    last.current = 0;
    setEvents([]);
    const add = (incoming: StintEvent[]) => {
      const fresh = incoming.filter((e) => e.seq > last.current).sort((a, b) => a.seq - b.seq);
      if (fresh.length === 0) return;
      last.current = fresh.at(-1)?.seq ?? last.current;
      setEvents((prev) => [...prev, ...fresh]);
    };
    const poll = () => void api.events(id, last.current).then((es) => live && add(es)).catch(() => undefined);
    api
      .events(id)
      .then((es) => live && add(es))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    const off = subscribe(`/api/tasks/${id}/stream`, (e) => live && add([e]), poll);
    return () => {
      live = false;
      off();
    };
  }, [id]);
  return { events, error };
}
