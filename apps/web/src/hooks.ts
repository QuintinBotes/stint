import type { StintEvent } from '@stint-dev/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type GoalListItem, type GoalView, type Health, type TaskBundle, type TaskCardData, api, subscribe } from './api';

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

/**
 * An element's content width as it resizes. A callback ref, so it attaches whenever the element mounts, including
 * after a loading state rendered something else first.
 */
export function useWidth<T extends HTMLElement>(initial: number) {
  const el = useRef<T | null>(null);
  const [width, setWidth] = useState(initial);
  const ref = useCallback((node: T | null) => {
    el.current = node;
    if (!node) return;
    const obs = new ResizeObserver(([e]) => e && setWidth(Math.round(e.contentRect.width)));
    obs.observe(node);
    return () => {
      obs.disconnect();
      el.current = null;
    };
  }, []);
  return { ref, el, width };
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

/** The goals, refetched when anything happens anywhere: a goal rolls up from its tasks (R-064). */
export function useGoals(): Loadable<GoalListItem[]> {
  const g = useLoad(api.goals, []);
  const refresh = useTrailing(g.reload, 500);
  useEffect(() => subscribe('/api/stream', refresh, refresh), [refresh]);
  return g;
}

/** One goal's view (its rollup, sharpen state and any split waiting), refetched when anything happens anywhere. */
export function useGoal(id: string): Loadable<GoalView> {
  const g = useLoad(() => api.goal(id), [id]);
  const refresh = useTrailing(g.reload, 300);
  useEffect(() => subscribe('/api/stream', refresh, refresh), [refresh]);
  return g;
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
