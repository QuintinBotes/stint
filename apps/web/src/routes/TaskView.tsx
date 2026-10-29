import type { Handoff, StintEvent } from '@stint-dev/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ROLE_NAMES, agentOf } from '../agents';
import { type TaskBundle, api, daemonMessage } from '../api';
import { ApprovalGate, gateState } from '../components/ApprovalGate';
import { HandoffCard, PlanCard, ReviewCard } from '../components/Cards';
import { DiffView, readViewedFiles, writeViewedFiles } from '../components/DiffView';
import { FilesTab } from '../components/Files';
import { HandTo } from '../components/HandTo';
import { Limits } from '../components/Limits';
import { HowItWent } from '../components/HowItWent';
import { MemoryPanel, Queue } from '../components/MemoryPanel';
import { PacketSources } from '../components/PacketSources';
import { PermissionBanner } from '../components/Permissions';
import { QuizPanel } from '../components/Quiz';
import { Rail } from '../components/Rail';
import { HELD, LOOKING_BACK_ID, LookingBack, Scrubber, clockLabel, taskClock } from '../components/Scrubber';
import { SharpenPanel } from '../components/SharpenPanel';
import { Terminal } from '../components/Terminal';
import { VerificationTab } from '../components/Verification';
import { WhoContinues } from '../components/WhoContinues';
import { Button, type ChipTone, CostMeter, EmptyState, Explain, Kbd, type Shape, StateMark, StatusChip, cx, tabClass, tabKeys } from '../components/ui';
import { money } from '../format';
import { useEvents, useTask } from '../hooks';
import { singleKey } from '../shortcuts';

const GRAPH_EVENTS = new Set(['run.finished', 'decision.recorded', 'review.recorded', 'skill.applied', 'skill.approved', 'approval.granted', 'approval.rejected', 'merge.completed', 'human.command']);

export const TABS = ['diff', 'files', 'terminal', 'plan', 'packet', 'review', 'verification'] as const;
export type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = { diff: 'Changes', files: 'Files', terminal: 'Terminal', plan: 'Plan', packet: 'Packet', review: 'Review', verification: 'Tests' };

/** Stops a live run and says so; a refusal shows the daemon's own words. */
function stopRun(taskId: string, run: string): Promise<unknown> {
  return api
    .stopRun(taskId, run)
    .then(() => toast.success(`${run} stopped. Stint writes its notes from the log.`))
    .catch((e: unknown) => toast.error(`${run} was not stopped: ${daemonMessage(e)}`));
}

/**
 * The task view: the title block across the top, with the state and the one next action, then the runs (320 px, 340 px
 * from 1180 px) with the one clock above them and the revision block docked under them, and the work area. Memory (360 px)
 * opens beside the work on request (`?memory=open`, or m); below 1180 px it drops under the work. Below 760 px it stacks
 * as gate, work, then runs, so the task's work comes before its long history. Looking back (`asOf`), a notice at the top
 * says so and every control that changes the task holds until Return to latest.
 */
export function TaskView() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: bundle, error, reload } = useTask(id);
  const { events } = useEvents(id);
  const [showAll, setShowAll] = useState(false);
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'diff';
  const selected = params.get('ev') ? Number(params.get('ev')) : null;
  const setParam = useCallback(
    (k: string, v: string | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (v === null) next.delete(k);
          else next.set(k, v);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setTab = useCallback((t: Tab) => setParam('tab', t), [setParam]);
  // memory is closed until asked for, so the work has the room; the URL keeps the choice
  const memOpen = params.get('memory') === 'open';
  const setMemOpen = useCallback((open: boolean) => setParam('memory', open ? 'open' : null), [setParam]);
  const fileParam = params.get('file');
  const [diffFiles, setDiffFiles] = useState<Array<{ path: string; added: number; removed: number }>>([]);
  const [viewed, setViewed] = useState<Set<string>>(() => readViewedFiles(id));
  useEffect(() => setViewed(readViewedFiles(id)), [id]);
  const toggleViewed = useCallback(
    (path: string) => {
      setViewed((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        writeViewedFiles(id, next);
        return next;
      });
    },
    [id],
  );
  // the palette's "Show the memory" opens the column and brings it on screen
  useEffect(() => {
    const show = () => {
      setMemOpen(true);
      requestAnimationFrame(() => document.getElementById('memory-title')?.scrollIntoView({ block: 'nearest' }));
    };
    window.addEventListener('stint:memory', show);
    return () => window.removeEventListener('stint:memory', show);
  }, [setMemOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!singleKey(e)) return;
      // read the URL as it is now, so a fast second press is not handled with the previous selection
      const current = new URLSearchParams(window.location.search);
      if (e.key === 'd') {
        setTab('diff');
        // the pane appears once the diff has loaded, so keep looking for it briefly
        let tries = 0;
        const timer = setInterval(() => {
          const pane = document.querySelector<HTMLElement>('[data-testid="diff-pane"]');
          if (pane) {
            pane.focus();
            clearInterval(timer);
          } else if (++tries > 20) clearInterval(timer);
        }, 50);
      } else if (e.key === '[' || e.key === ']') {
        const paths = diffFiles.map((f) => f.path);
        if (paths.length > 0) {
          const i = paths.indexOf(current.get('file') ?? (paths[0] as string));
          const next = e.key === ']' ? paths[Math.min(paths.length - 1, (i < 0 ? 0 : i) + 1)] : paths[Math.max(0, (i < 0 ? 0 : i) - 1)];
          if (next !== undefined) {
            // one update for both keys: two setParam calls in a row lose the first
            setParams(
              (p) => {
                const both = new URLSearchParams(p);
                both.set('file', next);
                both.set('tab', 'diff');
                return both;
              },
              { replace: true },
            );
          }
        }
      } else if (e.key === 'v') {
        const currentFile = current.get('file') ?? diffFiles[0]?.path;
        if (currentFile) toggleViewed(currentFile);
      } else if (e.key === 't') setTab('terminal');
      else if (e.key === 'h') setTab('packet');
      else if (e.key === 'm') setMemOpen(current.get('memory') !== 'open');
      else if (e.key === 'j' || e.key === 'k') {
        // the rows on the rail: those up to the moment the clock is on
        const until = current.get('asOf');
        const cut = until ? current.get('at') : null;
        const seqs = events.filter((x) => (cut ? x.seq <= Number(cut) : !until || x.ts <= until)).map((x) => x.seq);
        const at = current.get('ev') ? Number(current.get('ev')) : null;
        const i = at === null ? -1 : seqs.indexOf(at);
        const next = e.key === 'j' ? seqs[Math.min(seqs.length - 1, i + 1)] : seqs[Math.max(0, i - 1)];
        if (next !== undefined) setParam('ev', String(next));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [events, setParam, setTab, setParams, diffFiles, toggleViewed, setMemOpen]);
  const packetName = params.get('packet');
  const [packet, setPacket] = useState<Handoff | null>(null);
  const [packetNames, setPacketNames] = useState<string[]>([]);
  const handoffCount = useMemo(() => events.filter((e) => e.type === 'handoff.created').length, [events]);
  const diffVersion = useMemo(() => events.filter((e) => e.type === 'run.finished' || e.type === 'merge.completed').length, [events]);
  // a list read for this task is kept even when a newer read has started: dropping it left [ and ] with no files
  // while the events were still arriving. A failed read keeps the last list; only a new task starts empty.
  const diffFor = useRef(id);
  diffFor.current = id;
  useEffect(() => setDiffFiles([]), [id]);
  useEffect(() => {
    const want = id;
    api
      .diffFiles(id)
      .then((f) => diffFor.current === want && setDiffFiles(f))
      .catch(() => undefined);
  }, [id, diffVersion]);
  const decisions = useMemo(() => events.filter((e) => e.type === 'decision.recorded').map((e) => ({ id: String(e.payload.id ?? ''), text: String(e.payload.text ?? '') })), [events]);
  const graphVersion = useMemo(() => events.filter((e) => GRAPH_EVENTS.has(e.type)).length, [events]);
  const locked = useMemo(() => [...new Set(events.filter((e) => e.type === 'acceptance.locked').flatMap((e) => ((e.payload.files as Array<{ path: string }> | undefined) ?? []).map((f) => f.path)))].sort(), [events]);
  const autopilot = useMemo(() => {
    const last = events.filter((e) => e.type.startsWith('autopilot.')).at(-1);
    if (!last) return { on: false, text: null as string | null };
    // a stop at a limit is spelled out once, in the stop panel under the meters (R-062)
    if (last.type === 'autopilot.stopped' && last.payload.limit) return { on: false, text: 'stopped at a limit; it needs you.' };
    return { on: last.type !== 'autopilot.stopped', text: typeof last.payload.reason === 'string' ? last.payload.reason : last.type === 'autopilot.started' ? 'Starting.' : null };
  }, [events]);
  const pendingPermissions = useMemo(() => {
    const waiting = new Map<string, { task: string; run: string; requestId: string; tool: string; title: string; options: Array<{ optionId: string; name: string; kind: string }> }>();
    for (const e of events) {
      const requestId = typeof e.payload.requestId === 'string' ? e.payload.requestId : '';
      if (!requestId) continue;
      if (e.type === 'permission.requested') {
        const options = Array.isArray(e.payload.options)
          ? e.payload.options.map((o) => {
              const r = (o ?? {}) as Record<string, unknown>;
              return { optionId: String(r.optionId ?? ''), name: String(r.name ?? r.optionId ?? ''), kind: String(r.kind ?? 'allow_once') };
            })
          : [];
        waiting.set(requestId, { task: e.task, run: e.run ?? '', requestId, tool: String(e.payload.tool ?? 'tool'), title: String(e.payload.title ?? ''), options });
      } else if (e.type === 'permission.decided') {
        waiting.delete(requestId);
      }
    }
    return [...waiting.values()];
  }, [events]);
  const [autoBusy, setAutoBusy] = useState(false);
  const toggleAutopilot = () => {
    if (autoBusy) return;
    setAutoBusy(true);
    api
      .autopilot(id, !autopilot.on)
      .catch((e: unknown) => toast.error(`Autopilot did not ${autopilot.on ? 'stop' : 'start'}: ${daemonMessage(e)}`))
      .finally(() => setAutoBusy(false));
  };

  // the run a stop was sent to, until the daemon answers, so a second press sends nothing
  const [stopping, setStopping] = useState<string | null>(null);
  const stop = useCallback(
    (run: string) => {
      setStopping(run);
      void stopRun(id, run).finally(() => setStopping(null));
    },
    [id],
  );
  // Cmd+. (Ctrl+. elsewhere) stops the live run from anywhere on the task view, the terminal included: capture phase,
  // before xterm sees the key. Looking back, it does nothing, like every control that changes the task.
  const liveRunId = bundle?.runs.find((r) => !r.endedAt)?.run ?? null;
  const back = params.get('asOf') !== null;
  useEffect(() => {
    if (!liveRunId || back) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '.' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (stopping !== liveRunId) stop(liveRunId);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [liveRunId, back, stop, stopping]);

  // the moment the view shows: the rail, the revisions, the state, the packet, the diff and memory all read it.
  // asOf is the time memory reads; at, set by the clock, is the exact last event where several share a timestamp
  const asOf = params.get('asOf');
  const atParam = params.get('at');
  const atSeq = asOf && atParam !== null ? Number(atParam) : null;
  const visible = useMemo(() => (atSeq !== null ? events.filter((e) => e.seq <= atSeq) : asOf ? events.filter((e) => e.ts <= asOf) : events), [events, asOf, atSeq]);
  const clock = useMemo(() => taskClock(events), [events]);
  const setMoment = useCallback(
    (value: string | null, at?: number) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (value === null) next.delete('asOf');
          else next.set('asOf', value);
          if (value === null || at === undefined) next.delete('at');
          else next.set('at', String(at));
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  // a moment in the task's words: the story clock of a replay, else the time of day
  const clockFor = useCallback(
    (ms: number) => {
      const first = events[0] ? Date.parse(events[0].ts) : null;
      const last = events.at(-1) ? Date.parse((events.at(-1) as StintEvent).ts) : null;
      if (!clock.story || first === null || last === null || ms < first || ms > last + 60_000) return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      let i = 0;
      events.forEach((e, n) => {
        if (Date.parse(e.ts) <= ms) i = n;
      });
      return clockLabel(clock.at[i] as number, true, clock.base);
    },
    [events, clock],
  );
  const stops = useMemo(() => visible.filter((e) => e.type === 'handoff.created'), [visible]);
  const lastStop = stops.at(-1);
  const stopName = typeof lastStop?.payload.name === 'string' ? lastStop.payload.name : null;
  const latestName = useMemo(() => {
    const all = events.filter((e) => e.type === 'handoff.created').at(-1);
    return typeof all?.payload.name === 'string' ? all.payload.name : null;
  }, [events]);
  // the packet the view shows: the one asked for, else the one that was latest at the moment the clock is on
  const shownName = packetName ?? (asOf && stopName && stopName !== latestName ? stopName : null);
  useEffect(() => {
    let live = true;
    api
      .handoffNames(id)
      .then((n) => live && setPacketNames(n))
      .catch(() => undefined);
    if (shownName)
      api
        .handoff(id, shownName)
        .then((r) => live && setPacket(r.packet))
        .catch(() => live && setPacket(null));
    else setPacket(null);
    return () => {
      live = false;
    };
  }, [id, shownName, handoffCount]);
  // diff files written by the moment the clock is on, from the file.changed events up to it
  const atIndex = atSeq === null ? -1 : events.findIndex((e) => e.seq === atSeq);
  const momentLabel = !asOf ? null : atIndex >= 0 ? clockLabel(clock.at[atIndex] as number, clock.story, clock.base) : clockFor(Date.parse(asOf));
  const writtenBy = useMemo(() => (asOf ? new Set(visible.filter((e) => e.type === 'file.changed' && typeof e.payload.path === 'string').map((e) => e.payload.path as string)) : null), [visible, asOf]);

  // the daemon's words start lower case; the sentence on screen does not
  if (error) return <Placeholder title="This task could not be read">{`${error.charAt(0).toUpperCase()}${error.slice(1)}. Check the task id in the address, or go back to the board.`}</Placeholder>;
  if (!bundle) return <p className="p-6 text-ink-2">Reading the task.</p>;
  const t = bundle.task;
  // the task as it stood at the moment the clock is on; the gate always acts on the task as it is now
  const then = bundleAt(bundle, asOf ? visible : null);
  const live = then.runs.find((r) => !r.endedAt);
  const state = taskState(then, stopName);
  const lastBuild = then.runs.filter((r) => r.role === 'implementer').at(-1);
  const stopped = !live && then.task.status !== 'done' && lastBuild && (lastBuild.endedBy === 'killed' || lastBuild.endedBy === 'failed') ? lastBuild : null;
  const stoppedAt = stopped ? events.find((e) => e.type === 'run.finished' && e.run === stopped.run) : undefined;
  const openPacket = (name: string) => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('packet', name);
        next.set('tab', 'packet');
        return next;
      },
      { replace: true },
    );
  };
  // before the first packet, a rewound view has none to show
  const shownPacket = shownName ? packet : asOf && !stopName ? null : bundle.handoff;
  const packetLabel = shownName ?? (asOf ? stopName : latestName);
  // the run going now, which the stop control acts on wherever focus is (Cmd+. or Ctrl+.)
  const liveNow = bundle.runs.find((r) => !r.endedAt)?.run ?? null;
  const spentThen = then.runs.reduce((sum, r) => sum + (r.endedAt ? (r.cost?.usd ?? 0) : 0), 0);
  // a count beside a tab: files changed, plan steps, review findings, tests passed
  const counts: Partial<Record<Tab, string>> = {
    diff: diffFiles.length ? String(diffFiles.length) : undefined,
    plan: bundle.plan ? String(bundle.plan.steps.length) : undefined,
    review: bundle.review ? String(bundle.review.findings.length) : undefined,
    verification: bundle.verification ? String(bundle.verification.passed) : undefined,
  };

  const gate = gateState(bundle);
  // TaskView provides LookingBack, so it reads its own value rather than the context
  const hold = back ? HELD : {};
  // the one next action beside the state: stop a live run, or approve at an open gate. Looking back, the notice above has
  // Return to latest instead.
  const next = back ? null : liveNow ? (
    <Button tone="danger" disabled={stopping === liveNow} aria-busy={stopping === liveNow} title={`Stop ${liveNow}; Stint writes its notes from the log`} onClick={() => stop(liveNow)} data-testid="stop-run">
      {stopping === liveNow ? 'Stopping the run' : 'Stop the run'} <Kbd>⌘.</Kbd>
    </Button>
  ) : gate.open ? (
    // gets the gate's own Approve ready, beside the evidence, as the a key does: Enter or a second a merges
    <Button tone="primary" onClick={() => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'approve' }))} data-testid="header-approve">
      Approve and merge
    </Button>
  ) : null;
  const fact = 'flex items-baseline gap-1.5';
  const titleBlock = (
    <header data-testid="task-header" aria-labelledby="task-title" className="shrink-0 flex flex-col gap-3 px-4 min-[760px]:px-6 pt-4 pb-3 border-b border-rule bg-ground">
      {back ? (
        <div data-testid="rewound" className="stint-notice stint-notice--attention mb-0">
          <p id={LOOKING_BACK_ID}>
            You are looking at {t.id} as it was at <span className="font-mono font-semibold">{momentLabel}</span>. Actions that change the task are off until you return to latest.
          </p>
          <Button tone="primary" onClick={() => setMoment(null)} data-testid="return-latest">
            Return to latest
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1.5 min-w-0 max-w-[80ch]">
          <h1 id="task-title" className="stint-page-title">
            <span className="stint-task-id mr-2.5 text-[15px] align-[2px]">{t.id}</span>
            {t.title}
          </h1>
          <p className="text-ink-2">{t.goal}</p>
          <p data-testid="state-detail" className="text-small text-ink-2">
            {state.detail}
            {autopilot.text && !asOf ? (
              <span data-testid="autopilot-step">
                {' '}
                Autopilot: {autopilot.text}
              </span>
            ) : null}
          </p>
        </div>
        <div className="stint-actions" data-testid="next-action">
          <span data-testid="task-state">
            <StatusChip label={state.label} tone={state.tone} shape={state.shape} />
          </span>
          {next}
        </div>
      </div>
      {/* the facts, the autopilot switch and the limits as one quiet row that wraps */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-small text-ink-2">
        <dl data-testid="task-summary" className="flex flex-wrap items-center gap-x-5 gap-y-2 min-w-0">
          <div className={fact}>
            <dt>Spent</dt>
            <dd className="font-semibold text-ink" data-testid="task-cost">
              {/* a task nothing has run on says so, rather than a $0.00 that reads like a run */}
              {then.runs.length === 0 && !(bundle.cost?.usd ?? 0) ? (
                <span className="font-normal text-ink-3">nothing yet</span>
              ) : asOf ? (
                <span className="tabular">{money({ usd: spentThen })}</span>
              ) : (
                <CostMeter cost={bundle.cost} />
              )}
            </dd>
          </div>
          <div className={fact}>
            <dt>Runs</dt>
            <dd className="font-semibold text-ink tabular">{then.runs.length}</dd>
          </div>
          <div className={cx(fact, 'min-w-0')} title={`Started from commit ${t.baseCommit.slice(0, 7)}`}>
            <dt>Branch</dt>
            <dd className="font-mono text-ink truncate">{t.branch}</dd>
          </div>
        </dl>
        {t.links.issueUrl ? (
          <a href={t.links.issueUrl} data-testid="issue-link" className="text-ink underline decoration-rule-strong hover:decoration-ink" target="_blank" rel="noreferrer">
            Issue
          </a>
        ) : null}
        {t.status !== 'done' ? (
          <Button
            className="h-7 px-2.5 text-small min-[760px]:min-h-7"
            onClick={toggleAutopilot}
            disabled={autoBusy}
            aria-busy={autoBusy}
            aria-pressed={autopilot.on}
            data-testid="autopilot-switch"
            title="Plan, build, verify and review on its own, handing off when a run fails; it stops at your approval"
            {...hold}
          >
            {autoBusy ? (autopilot.on ? 'Stopping autopilot' : 'Starting autopilot') : autopilot.on ? 'Autopilot on' : 'Autopilot'}
          </Button>
        ) : null}
        <Limits taskId={t.id} events={events} onHand={() => setTab('packet')} />
      </div>
    </header>
  );

  const stopAgent = stopped ? agentOf(stopped.adapter, stopped.host, stopped.model) : null;
  const inFlight = stoppedAt && typeof stoppedAt.payload.inFlight === 'string' && stoppedAt.payload.inFlight;
  const killNotice =
    stopped && stopAgent ? (
      <div role="status" data-testid="kill-notice" className="stint-notice stint-notice--error shrink-0 mx-4 min-[760px]:mx-6 mt-3 mb-0">
        <p className="min-w-0 flex-1 basis-[40ch]">
          <b className="inline-flex items-center gap-1.5 font-semibold text-red">
            <StateMark shape="failed" />
            {stopped.endedBy === 'killed' ? 'Killed' : 'Failed'}
            {stoppedAt ? ` at ${clockFor(Date.parse(stoppedAt.ts))}` : ''}.
          </b>{' '}
          {stopAgent.name} {stopped.run} {stopped.endedBy === 'killed' ? 'was stopped before it finished.' : 'ended with a failure.'}{' '}
          {stopName && lastStop
            ? `Stint wrote its notes from the log as packet ${stopName} (${Number(lastStop.payload.tokens) || 0} tokens${inFlight ? ', with the step it was in the middle of marked unknown' : ''}), so the next agent starts from there. Nothing is lost.`
            : 'Stint is writing its notes from the log.'}
        </p>
        {stopName ? (
          <Button className="h-8 px-2.5 text-small" onClick={() => openPacket(stopName)}>
            Open packet {stopName}
          </Button>
        ) : null}
      </div>
    ) : null;

  // On a phone the gate and the work come first and the run history last; from 760 px the runs sit in the left column
  // over the gate, each in its own place, so the gate never covers a run.
  const rail = (
    <aside aria-labelledby="runs-title" data-testid="rail-column" className="min-w-0 flex flex-col bg-panel border-t border-rule min-[760px]:[grid-area:1/1/2/2] min-[760px]:border-t-0 min-[760px]:border-r min-[1180px]:min-h-0">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1.5">
        <h2 id="runs-title" className="text-section">
          Runs
        </h2>
        {/* 32 px in the dense column from 760 px; a phone keeps the 44 px target */}
        <Button className="h-8 px-2.5 text-small min-[760px]:min-h-8" onClick={() => setShowAll((s) => !s)} aria-pressed={showAll} data-testid="show-all">
          {showAll ? 'Key events only' : `Show all ${visible.length}`}
        </Button>
      </div>
      <div className="px-4 pb-3">
        <Scrubber events={events} live={!!liveNow} asOf={asOf} atSeq={atSeq} reading={momentLabel} onAsOf={setMoment} />
      </div>
      <div data-testid="rail-scroller" className="relative min-h-0 overflow-y-auto max-h-[60vh] min-[760px]:max-h-[45vh] min-[1180px]:max-h-none min-[1180px]:flex-1 border-t border-rule">
        <Rail events={visible} runs={bundle.runs} showAll={showAll} selected={selected} onSelect={(s) => setParam('ev', String(s))} onOpenPacket={openPacket} rewound={!!asOf} />
      </div>
    </aside>
  );
  const gateBox = (
    <div data-testid="gate-column" className="min-w-0 px-3 pt-3 pb-4 bg-panel border-b border-rule min-[760px]:[grid-area:2/1/3/2] min-[760px]:border-b-0 min-[760px]:border-r min-[760px]:border-t min-[760px]:border-t-rule-strong min-[1180px]:overflow-y-auto">
      <ApprovalGate bundle={bundle} events={events} seen={asOf ? visible : null} files={diffFiles} viewed={viewed} onDone={reload} />
    </div>
  );
  const work = (
    <section aria-label="Work" className="relative min-w-0 flex flex-col gap-4 px-4 min-[760px]:px-6 pt-3 pb-8 min-[760px]:[grid-area:1/2/3/3] min-[1180px]:overflow-y-auto">
      {/* what needs doing next comes before the tabs, and only when it applies: who continues a stopped run, a decision on this task */}
      <WhoContinues bundle={bundle} onChoose={() => setTab('packet')} />
      <Queue decisionsOf={t.id} level={2} />
      <PermissionBanner permissions={pendingPermissions.filter((p) => p.run === (bundle.runs.find((r) => !r.endedAt)?.run ?? p.run))} />
      <SharpenPanel bundle={bundle} events={events} />
      <div className="flex items-end gap-3 border-b border-rule">
        {/* one row on a phone: it scrolls sideways rather than wrapping onto two */}
        <div role="tablist" aria-label="Work area" className="flex min-w-0 flex-1 overflow-x-auto" onKeyDown={tabKeys}>
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`tab-${k}`}
              aria-selected={tab === k}
              aria-controls="work-panel"
              tabIndex={tab === k ? 0 : -1}
              data-testid={`tab-${k}`}
              onClick={() => setTab(k)}
              className={tabClass(tab === k)}
            >
              {TAB_NAMES[k]}
              {counts[k] ? (
                <span aria-hidden="true" className="text-small font-normal text-ink-3">
                  {counts[k]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <Button
          className="mb-1 h-8 px-2.5 text-small shrink-0"
          aria-expanded={memOpen}
          aria-controls="memory-column"
          aria-keyshortcuts="m"
          onClick={() => setMemOpen(!memOpen)}
          data-testid="memory-toggle"
        >
          {memOpen ? 'Hide memory' : 'Memory'} <Kbd>m</Kbd>
        </Button>
      </div>
      {/* focusable, so a keyboard can reach and scroll it */}
      <div className="min-w-0" role="tabpanel" id="work-panel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {tab === 'diff' ? (
          <DiffView
            taskId={t.id}
            version={diffVersion}
            files={diffFiles}
            file={fileParam}
            onFile={(path) => setParam('file', path)}
            events={events}
            runs={bundle.runs}
            viewed={viewed}
            onToggleViewed={toggleViewed}
            writtenBy={writtenBy}
            asOfLabel={momentLabel}
          />
        ) : null}
        {tab === 'files' ? <FilesTab taskId={t.id} /> : null}
        {tab === 'terminal' ? <Terminal taskId={t.id} liveRun={liveNow} onStop={liveNow ? () => stopping !== liveNow && stop(liveNow) : undefined} /> : null}
        {tab === 'plan' ? <PlanCard plan={bundle.plan} handoff={bundle.handoff} status={t.status} /> : null}
        {tab === 'packet' ? (
          <div className="flex flex-col gap-5">
            {packetNames.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Packets">
                <span className="text-small text-ink-2 mr-1">Every packet is kept:</span>
                {packetNames.map((n) => (
                  <Button key={n} className="h-8 px-2.5 text-small font-mono" aria-pressed={(packetLabel ?? packetNames.at(-1)) === n} onClick={() => setParam('packet', n)}>
                    {n}
                  </Button>
                ))}
              </div>
            ) : null}
            {asOf && !packetName ? <p className="text-small text-ink-2">The packet as it stood at {momentLabel}.</p> : null}
            <HandoffCard handoff={shownPacket} name={packetLabel} status={then.task.status} />
            {t.status !== 'done' ? <HandTo taskId={t.id} packet={shownName ? packet : bundle.handoff} live={bundle.runs.some((r) => !r.endedAt)} atGate={t.status === 'awaiting_approval'} /> : null}
            {packetNames.length ? <PacketSources taskId={t.id} name={packetLabel ?? (packetNames.at(-1) as string)} events={events} onSelect={(seq) => setParam('ev', String(seq))} /> : null}
            {packetNames.length ? <QuizPanel taskId={t.id} name={packetLabel ?? (packetNames.at(-1) as string)} events={events} /> : null}
          </div>
        ) : null}
        {tab === 'review' ? <ReviewCard review={bundle.review} decisions={decisions} status={t.status} /> : null}
        {tab === 'verification' ? <VerificationTab taskId={t.id} acceptance={t.acceptance} locked={locked} live={bundle.runs.some((r) => !r.endedAt)} onChanged={reload} status={t.status} /> : null}
      </div>
    </section>
  );

  const memory = memOpen ? (
    <aside
      id="memory-column"
      aria-labelledby="memory-title"
      data-testid="memory-column"
      className="relative min-w-0 flex flex-col gap-4 px-4 min-[760px]:px-5 py-5 border-t border-rule min-[760px]:[grid-area:3/1/4/3] min-[1180px]:[grid-area:1/3/3/4] min-[1180px]:border-t-0 min-[1180px]:border-l min-[1180px]:overflow-y-auto"
    >
      <div>
        <h2 id="memory-title" className="text-section">
          Memory
        </h2>
        <Explain word="memory" className="mt-1" />
      </div>
      <MemoryPanel
            id={t.id}
            asOf={asOf}
            version={graphVersion}
            onOpenFile={(path) => {
              setParams(
                (p) => {
                  const both = new URLSearchParams(p);
                  both.set('file', path);
                  both.set('tab', 'diff');
                  return both;
                },
                { replace: true },
              );
            }}
          />
    </aside>
  ) : null;

  return (
    <LookingBack.Provider value={back}>
      <main className="relative flex-1 min-h-0 overflow-y-auto min-[1180px]:overflow-hidden min-[1180px]:flex min-[1180px]:flex-col" data-testid="task-view">
        {titleBlock}
        {killNotice}
        {/* the outcome is the task as it ended, so it waits while the page shows an earlier moment */}
        {!back && ['done', 'rejected', 'abandoned'].includes(t.status) ? <HowItWent bundle={bundle} after /> : null}
        <div
          className={cx(
            'grid grid-cols-1 min-[760px]:grid-cols-[320px_minmax(0,1fr)] min-[760px]:grid-rows-[auto_1fr] min-[1180px]:grid-cols-[340px_minmax(0,1fr)] min-[1180px]:flex-1 min-[1180px]:min-h-0 min-[1180px]:grid-rows-[minmax(280px,1fr)_minmax(0,auto)]',
            memOpen && 'min-[1180px]:grid-cols-[340px_minmax(0,1fr)_360px]',
          )}
        >
          {gateBox}
          {work}
          {rail}
          {memory}
        </div>
      </main>
    </LookingBack.Provider>
  );
}

/**
 * The task as it stood at a moment: its status, its runs, its last verification, review and merge, from the events seen by then.
 * The bundle is the task now; null is now.
 */
export function bundleAt(b: TaskBundle, seen: StintEvent[] | null): TaskBundle {
  if (!seen) return b;
  const last = (type: string) => [...seen].reverse().find((e) => e.type === type);
  const status = last('task.status')?.payload.to;
  const runs = b.runs
    .filter((r) => seen.some((e) => e.type === 'run.started' && e.run === r.run))
    .map((r) => {
      const fin = seen.find((e) => e.type === 'run.finished' && e.run === r.run);
      return fin ? { ...r, endedAt: fin.ts, endedBy: typeof fin.payload.endedBy === 'string' ? fin.payload.endedBy : r.endedBy } : { ...r, endedAt: null, endedBy: null };
    });
  const ver = last('verification.ran');
  const verification = ver && b.verification ? { ...b.verification, status: ver.payload.status === 'red' ? ('red' as const) : ('green' as const), passed: Number(ver.payload.passed) || 0, failed: Number(ver.payload.failed) || 0 } : null;
  return {
    ...b,
    task: { ...b.task, status: typeof status === 'string' ? (status as TaskBundle['task']['status']) : 'planned' },
    runs,
    verification,
    review: last('review.recorded') ? b.review : null,
    merge: last('merge.completed') ? b.merge : null,
  };
}

const DOING: Record<string, string> = { planner: 'Planning', implementer: 'Building', reviewer: 'Reviewing' };

/** The task's one status for the title block, with a plain line under it that says what is happening. */
function taskState(b: TaskBundle, packetName: string | null): { tone: ChipTone; label: string; detail: string; shape?: Shape } {
  const t = b.task;
  const live = b.runs.find((r) => !r.endedAt);
  const v = b.verification;
  const lastBuild = b.runs.filter((r) => r.role === 'implementer').at(-1);
  if (t.status === 'done') return { tone: 'merged', label: 'Merged', detail: `Approved by ${!b.merge?.by || b.merge.by === 'human' ? 'you' : b.merge.by} and merged.` };
  if (t.status === 'awaiting_approval') return { tone: 'warn', label: 'Awaiting approval', detail: v ? `Stint ran the tests: ${v.passed} passed${b.review ? ', and the review is done' : ''}. Waiting for your approval.` : 'Waiting for your approval; the tests have not run yet.' };
  if (t.status === 'rejected') return { tone: 'bad', label: 'Rejected', detail: 'Rejected at the gate. Hand it on with the reason, or leave it.' };
  if (live) {
    const a = agentOf(live.adapter, live.host, live.model);
    return { tone: 'active', label: DOING[live.role ?? ''] ?? 'Running', detail: `${a.name} ${live.run} ${ROLE_NAMES[live.role ?? ''] ?? 'runs'} in its worktree.` };
  }
  if (lastBuild && (lastBuild.endedBy === 'killed' || lastBuild.endedBy === 'failed')) {
    const a = agentOf(lastBuild.adapter, lastBuild.host, lastBuild.model);
    return { tone: 'bad', label: 'Stopped', detail: `${a.name} ${lastBuild.run} ${lastBuild.endedBy === 'killed' ? 'was killed' : 'failed'}${packetName ? `; packet ${packetName} was built anyway` : ''}.` };
  }
  if (t.status === 'verifying') return { tone: 'active', label: 'Verifying', detail: 'Stint is running the tests on the task branch.' };
  if (t.status === 'reviewing') return { tone: 'active', label: 'Reviewing', detail: 'A review is offered only after a green verification.' };
  // a pull request waiting on its review: nothing of Stint's runs, so it waits with a ring, never a running dot
  if (t.status === 'in_review') return { tone: 'neutral', shape: 'waiting', label: 'In PR review', detail: 'A pull request waits; the task finishes when it merges.' };
  if (t.status === 'approved') return { tone: 'merged', label: 'Approved', detail: 'Approved; the merge is under way.' };
  if (t.status === 'planned') return { tone: 'neutral', shape: 'waiting', label: 'Planned', detail: b.plan ? 'Planned, waiting for an agent.' : 'Waiting for a plan and an agent.' };
  return { tone: 'neutral', shape: 'waiting', label: 'Waiting', detail: 'Waiting for the next run.' };
}

/** A page with nothing to show: its title and a sentence that says what to do. */
export function Placeholder({ title, children }: { title: string; children: string }) {
  return (
    <main className="relative flex-1 min-h-0 overflow-y-auto">
      <div className="stint-page">
        <h1 className="stint-page-title">{title}</h1>
        <EmptyState>{children}</EmptyState>
      </div>
    </main>
  );
}
