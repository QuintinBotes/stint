import type { Handoff, StintEvent } from '@stint-dev/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ROLE_NAMES, agentOf, carNumber } from '../agents';
import { type TaskBundle, api, daemonMessage } from '../api';
import { toast } from 'sonner';
import { ApprovalGate } from '../components/ApprovalGate';
import { HandoffCard, PlanCard, ReviewCard } from '../components/Cards';
import { DiffView, readViewedFiles, writeViewedFiles } from '../components/DiffView';
import { HandTo } from '../components/HandTo';
import { MemoryPanel, Queue } from '../components/MemoryPanel';
import { PacketSources } from '../components/PacketSources';
import { PermissionBanner } from '../components/Permissions';
import { PitBoard, boardLines } from '../components/PitWall';
import { QuizPanel } from '../components/Quiz';
import { Terminal } from '../components/Terminal';
import { FilesTab } from '../components/Files';
import { VerificationTab } from '../components/Verification';
import { WhoContinues } from '../components/WhoContinues';
import { Rail } from '../components/Rail';
import { StintChart, clockLabel, taskClock } from '../components/StintChart';
import { Button, type ChipTone, CostMeter, EmptyState, Kbd, Swatch, cx } from '../components/ui';
import { useEvents, useTask } from '../hooks';
import { singleKey } from '../shortcuts';

const GRAPH_EVENTS = new Set(['run.finished', 'decision.recorded', 'review.recorded', 'skill.applied', 'skill.approved', 'approval.granted', 'approval.rejected', 'merge.completed', 'human.command']);

export const TABS = ['diff', 'memory', 'files', 'terminal', 'plan', 'packet', 'review', 'verification'] as const;
export type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = { diff: 'Diff', memory: 'Memory', files: 'Files', terminal: 'Terminal', plan: 'Plan', packet: 'Packet', review: 'Review', verification: 'Verification' };

/** Race control is a drawer: open on a wide screen, closed below 1600 px until its button, j or k, or a linked event opens it. */
const WIDE = '(min-width: 1600px)';

/** Stops a live run and says so; a refusal shows the daemon's own words. */
function stopRun(taskId: string, run: string): void {
  api
    .stopRun(taskId, run)
    .then(() => toast.success(`${run} stopped. The daemon builds a packet from the log.`))
    .catch((e: unknown) => toast.error(`${run} was not stopped: ${daemonMessage(e)}`));
}

export function TaskView() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: bundle, error, reload } = useTask(id);
  const { events } = useEvents(id);
  const [showAll, setShowAll] = useState(false);
  const [railOpen, setRailOpen] = useState(() => (typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches) || new URLSearchParams(window.location.search).has('ev'));
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'diff';
  const selected = params.get('ev') ? Number(params.get('ev')) : null;
  useEffect(() => {
    if (selected !== null) setRailOpen(true);
  }, [selected]);
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
      else if (e.key === 'm') setTab(new URLSearchParams(window.location.search).get('tab') === 'memory' ? 'diff' : 'memory');
      else if (e.key === 'j' || e.key === 'k') {
        setRailOpen(true);
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
  }, [events, selected, setParam, setTab, diffFiles, fileParam, toggleViewed]);
  const packetName = params.get('packet');
  const [packet, setPacket] = useState<Handoff | null>(null);
  const [packetNames, setPacketNames] = useState<string[]>([]);
  const handoffCount = useMemo(() => events.filter((e) => e.type === 'handoff.created').length, [events]);
  useEffect(() => {
    let live = true;
    api.handoffNames(id).then((n) => live && setPacketNames(n)).catch(() => undefined);
    if (packetName) api.handoff(id, packetName).then((r) => live && setPacket(r.packet)).catch(() => live && setPacket(null));
    else setPacket(null);
    return () => {
      live = false;
    };
  }, [id, packetName, handoffCount]);
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
    setAutoBusy(true);
    api
      .autopilot(id, !autopilot.on)
      .catch((e: unknown) => toast.error(`Autopilot did not ${autopilot.on ? 'stop' : 'start'}: ${daemonMessage(e)}`))
      .finally(() => setAutoBusy(false));
  };

  // Cmd+. (Ctrl+. elsewhere) stops the run on track from anywhere on the task view, the terminal included: capture
  // phase, before xterm sees the key
  const liveRunId = bundle?.runs.find((r) => !r.endedAt)?.run ?? null;
  useEffect(() => {
    if (!liveRunId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '.' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      stopRun(id, liveRunId);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [id, liveRunId]);

  // the moment the view shows: the stint chart, race control, the pit board, the diff and memory all read it
  // asOf is the time memory reads; at, set by the stint chart, is the exact last event where several share a timestamp
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
  // a moment on the memory graph's own clock, in the task's words: the story clock of a replay, else the time of day
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
  // the packet the pit board shows: the latest, or the one that was latest at the moment the clock is on
  const [boardPacket, setBoardPacket] = useState<{ name: string; packet: Handoff } | null>(null);
  useEffect(() => {
    if (!stopName || stopName === latestName) {
      setBoardPacket(null);
      return;
    }
    let live = true;
    api
      .handoff(id, stopName)
      .then((r) => live && setBoardPacket({ name: stopName, packet: r.packet }))
      .catch(() => live && setBoardPacket(null));
    return () => {
      live = false;
    };
  }, [id, stopName, latestName]);
  // diff files written by the moment the clock is on, from the file.changed events up to it
  const atIndex = atSeq === null ? -1 : events.findIndex((e) => e.seq === atSeq);
  const momentLabel = !asOf ? null : atIndex >= 0 ? clockLabel(clock.at[atIndex] as number, clock.story, clock.base) : clockFor(Date.parse(asOf));
  // memory names the moment as the chart does when the chart set it
  const memoryClock = useCallback((ms: number) => (momentLabel && asOf && ms === Date.parse(asOf) ? momentLabel : clockFor(ms)), [momentLabel, asOf, clockFor]);
  const writtenBy = useMemo(() => (asOf ? new Set(visible.filter((e) => e.type === 'file.changed' && typeof e.payload.path === 'string').map((e) => e.payload.path as string)) : null), [visible, asOf]);

  if (error) return <p className="p-6 text-red">This task could not be read: {error}. Check the task id, or go back to Timing.</p>;
  if (!bundle) return <p className="p-6 text-ink-3">Reading the task.</p>;
  const t = bundle.task;
  // the car as it stood at the moment the clock is on; the gate always acts on the car as it is now
  const then = bundleAt(bundle, asOf ? visible : null);

  const live = then.runs.find((r) => !r.endedAt);
  const v = then.verification;
  const state = carState(then, stopName);
  const lastBuild = then.runs.filter((r) => r.role === 'implementer').at(-1);
  const redFlag = !live && then.task.status !== 'done' && lastBuild && (lastBuild.endedBy === 'killed' || lastBuild.endedBy === 'failed') ? lastBuild : null;
  const redAt = redFlag ? events.find((e) => e.type === 'run.finished' && e.run === redFlag.run) : undefined;
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
  const shownPacket = boardPacket ? boardPacket.packet : stopName ? bundle.handoff : null;
  const shownMeta = { name: stopName, tokens: lastStop ? Number(lastStop.payload.tokens) || null : null, bytes: lastStop ? Number(lastStop.payload.bytes) || null : null };

  // the run on track now, which the stop control acts on wherever focus is (Cmd+. or Ctrl+.)
  const liveNow = bundle.runs.find((r) => !r.endedAt)?.run ?? null;
  const panelTitle = 'text-[14px] leading-5 font-bold';

  const header = (
    <header className="shrink-0 flex flex-wrap items-start justify-between gap-x-8 gap-y-4 px-4 sm:px-6 pt-6 pb-5" data-testid="task-header">
      <div className="flex items-start gap-4 min-w-0 flex-1 basis-[420px]">
        <div aria-label={`Car ${carNumber(t.id)}, task ${t.id}`} role="img" className="flex flex-col items-center justify-center shrink-0 min-w-16 h-16 px-2 rounded-[4px] bg-plate text-on-plate">
          <span aria-hidden="true" className="text-[34px] leading-8 font-black stretch-62 tabular">
            {carNumber(t.id)}
          </span>
          <span aria-hidden="true" className="font-mono text-[12px] leading-4">
            {t.id}
          </span>
        </div>
        <div className="min-w-0 flex flex-col gap-2">
          <h1 className="text-[19px] leading-6 sm:text-[34px] sm:leading-10 font-bold stretch-112 tracking-[-0.02em] [text-wrap:balance]">{t.title}</h1>
          <p className="text-ink-2 max-w-[70ch]">{t.goal}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-ink-2">
            <span>
              branch <span className="font-mono">{t.branch}</span>, base <span className="font-mono">{t.baseCommit.slice(0, 7)}</span>
            </span>
            {t.links.issueUrl ? (
              <a href={t.links.issueUrl} data-testid="issue-link" className="underline underline-offset-2 text-ink" target="_blank" rel="noreferrer">
                Issue
              </a>
            ) : null}
            {t.status !== 'done' ? (
              <Button
                className="h-7"
                onClick={toggleAutopilot}
                disabled={autoBusy}
                aria-pressed={autopilot.on}
                data-testid="autopilot-switch"
                title="Plan, build, verify and review on its own, handing off when a run fails; it stops at your approval"
              >
                {autopilot.on ? 'Autopilot on' : 'Autopilot'}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-start gap-3 min-w-[220px] max-w-[360px]">
        <span className="flex flex-col items-start gap-1" data-testid="car-state">
          <span className="inline-flex items-center gap-2 text-[19px] leading-6 font-bold">
            <Swatch tone={state.tone} />
            {state.label}
          </span>
          <span className="text-[14px] text-ink-2">{state.detail}</span>
          {autopilot.text && !asOf ? (
            <span className="text-[12px] text-ink-2" data-testid="autopilot-step">
              Autopilot: {autopilot.text}
            </span>
          ) : null}
        </span>
        {liveNow && !asOf ? (
          <Button tone="danger" className="h-8" title={`Stop ${liveNow}; the daemon builds a packet from the log`} onClick={() => stopRun(t.id, liveNow)} data-testid="stop-run">
            Stop the run <Kbd>⌘.</Kbd>
          </Button>
        ) : null}
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[12px]" data-testid="task-summary">
          <dt className="text-ink-2">Task total</dt>
          <dd className="font-bold" data-testid="task-cost">
            <CostMeter cost={bundle.cost} />
          </dd>
          <dt className="text-ink-2">Tests</dt>
          <dd className="tabular">{v ? `${v.passed} passed${v.failed ? `, ${v.failed} failed` : ''}${v.tamper === null ? ', unchanged' : ''}, by the daemon` : 'not run yet'}</dd>
        </dl>
      </div>
    </header>
  );

  const rail = (
    <section id="race-control" aria-labelledby="race-control-title" className="min-w-0 flex flex-col" data-testid="rail-column">
      <div className="flex items-baseline justify-between gap-2 pb-2">
        <h2 id="race-control-title" className="text-[19px] leading-6 font-bold stretch-112 whitespace-nowrap">
          Race control
        </h2>
        <span className="flex items-center gap-2 text-[12px] text-ink-2">
          <Button className="h-7 px-2 text-[12px]" onClick={() => setShowAll((s) => !s)} aria-pressed={showAll} data-testid="show-all">
            {showAll ? 'Show what matters' : 'Show all'}
          </Button>
          <Button className="h-7 px-2 text-[12px]" onClick={() => setRailOpen(false)} aria-controls="race-control">
            Close
          </Button>
        </span>
      </div>
      {asOf ? (
        <p className="mb-2 flex flex-wrap items-center gap-2 rounded-[3px] bg-panel px-3 py-2 text-[12px] text-ink-2" data-testid="rewound">
          As it stood at <span className="tabular font-bold text-ink">{momentLabel}</span> on the race clock.
          <button type="button" className="underline underline-offset-2 text-ink" onClick={() => setMoment(null)}>
            Back to the latest
          </button>
        </p>
      ) : null}
      <div className="relative min-h-0 max-h-[70vh] lg:max-h-[calc(100vh-150px)] overflow-y-auto border-t border-rule-strong">
        <Rail events={visible} runs={bundle.runs} showAll={showAll} selected={selected} onSelect={(s) => setParam('ev', String(s))} onOpenPacket={openPacket} rewound={!!asOf} />
      </div>
    </section>
  );

  const memory = (
    <MemoryPanel
      id={t.id}
      asOf={asOf}
      version={graphVersion}
      clock={memoryClock}
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
  );

  const work = (
    <section aria-label="Work" className="min-w-0 flex flex-col gap-3">
      <div className="flex items-end gap-4 border-b border-rule">
        {!railOpen ? (
          <button
            type="button"
            data-testid="race-control-toggle"
            aria-expanded={false}
            aria-controls="race-control"
            onClick={() => setRailOpen(true)}
            className="shrink-0 mb-2 h-7 px-2 rounded-[3px] border border-ink-3 text-[12px] text-ink hover:border-ink"
          >
            Race control <span className="tabular text-ink-2">{asOf ? `${visible.length} of ${events.length}` : events.length} events</span>
          </button>
        ) : null}
        <div role="tablist" aria-label="Work area" className="flex gap-5 overflow-x-auto min-w-0">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              data-testid={`tab-${k}`}
              onClick={() => setTab(k)}
              className={cx('pb-2 -mb-px border-b-2 text-[14px] whitespace-nowrap', tab === k ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-2 hover:text-ink')}
            >
              {TAB_NAMES[k]}
            </button>
          ))}
        </div>
      </div>
      <PermissionBanner permissions={pendingPermissions.filter((p) => p.run === (bundle.runs.find((r) => !r.endedAt)?.run ?? p.run))} />
      {/* focusable, so a keyboard can reach and scroll it */}
      <div className="min-w-0" role="tabpanel" aria-label={TAB_NAMES[tab]} tabIndex={0}>
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
        {tab === 'memory' ? memory : null}
        {tab === 'files' ? <FilesTab taskId={t.id} /> : null}
        {tab === 'terminal' ? <Terminal taskId={t.id} liveRun={liveNow} onStop={liveNow ? () => stopRun(t.id, liveNow) : undefined} /> : null}
        {tab === 'plan' ? <PlanCard plan={bundle.plan} handoff={bundle.handoff} status={t.status} /> : null}
        {tab === 'packet' ? (
          <div className="flex flex-col gap-4">
            {packetNames.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Packets">
                <span className="text-[14px] text-ink-2 mr-1">Pit stops</span>
                {packetNames.map((n) => (
                  <Button key={n} className="h-7" aria-pressed={(packetName ?? packetNames.at(-1)) === n} onClick={() => setParam('packet', n)}>
                    {n}
                  </Button>
                ))}
              </div>
            ) : null}
            <HandoffCard handoff={packetName ? packet : bundle.handoff} status={t.status} />
            {t.status !== 'done' ? <HandTo taskId={t.id} packet={packetName ? packet : bundle.handoff} live={bundle.runs.some((r) => !r.endedAt)} atGate={t.status === 'awaiting_approval'} /> : null}
            {packetNames.length ? <PacketSources taskId={t.id} name={packetName ?? (packetNames.at(-1) as string)} events={events} onSelect={(seq) => setParam('ev', String(seq))} /> : null}
            {packetNames.length ? <QuizPanel taskId={t.id} name={packetName ?? (packetNames.at(-1) as string)} events={events} /> : null}
          </div>
        ) : null}
        {tab === 'review' ? <ReviewCard review={bundle.review} decisions={decisions} status={t.status} /> : null}
        {tab === 'verification' ? <VerificationTab taskId={t.id} acceptance={t.acceptance} locked={locked} live={bundle.runs.some((r) => !r.endedAt)} onChanged={reload} status={t.status} /> : null}
      </div>
    </section>
  );

  // the pit board shows a packet's ask while someone still has to act on it: on track or in the pits, not at the gate or after the flag
  const askLive = !!stopName && !['done', 'approved', 'awaiting_approval', 'abandoned'].includes(then.task.status);
  const pitBoard = askLive ? (
    <section className="flex flex-col gap-2" aria-labelledby="pit-board-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="pit-board-title" className={panelTitle}>
          Pit board
        </h2>
        <button type="button" className="text-[12px] text-ink-2 underline-offset-2 hover:text-ink hover:underline" onClick={() => openPacket(stopName as string)}>
          {stopName}
          {shownMeta.tokens ? `, ${shownMeta.tokens} tokens` : ''}
          {asOf ? ', as it stood' : ''}
        </button>
      </div>
      <PitBoard lines={boardLines(t.id, shownPacket, shownMeta)} label={`Pit board, packet ${stopName}'s ask of next`} onOpen={() => openPacket(stopName as string)} />
      {shownPacket && (shownPacket.from.endedBy === 'killed' || shownPacket.from.endedBy === 'failed') ? (
        <p className="text-[12px] text-ink-2">
          {agentOf(shownPacket.from.adapter, shownPacket.from.host, shownPacket.from.model).code} was {shownPacket.from.endedBy === 'killed' ? 'stopped' : 'out with a failure'}, so the daemon built this packet from the event log and the worktree.
        </p>
      ) : null}
    </section>
  ) : null;
  const stewards = <Queue stewardsOf={t.id} />;
  const change = <WhoContinues bundle={bundle} onChoose={() => setTab('packet')} />;
  const gate = <ApprovalGate bundle={bundle} onDone={reload} />;
  // what needs the person comes first: the gate when the car waits there, the driver change after a red flag; rewound,
  // the order follows the car as it stood, so the moment's own panel leads
  const stoppedNow = !!redFlag;
  const order =
    then.task.status === 'awaiting_approval' || then.task.status === 'done'
      ? [gate, stewards, pitBoard]
      : stoppedNow
        ? [change, pitBoard, stewards, gate]
        : [pitBoard, stewards, gate];

  const side = (
    <aside aria-label="What needs you" className="min-w-0 flex flex-col gap-6">
      {asOf ? <p className="text-[12px] text-ink-2">The stewards and the flag act on the car as it is now, not as it stood at {momentLabel}.</p> : null}
      {order.map((panel, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the order is fixed per state, so the index names the slot
        <div key={i} className="min-w-0 empty:hidden">
          {panel}
        </div>
      ))}
    </aside>
  );

  return (
    <main className="relative flex-1 min-h-0 overflow-y-auto" data-testid="task-view">
      {redFlag ? (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-6 py-3 bg-[var(--red-band)] text-[var(--red-band-ink)]" data-testid="red-flag">
          <span aria-hidden="true" className="w-6 h-4 rounded-[2px] bg-[var(--sw-red)] shadow-[inset_0_0_0_2px_var(--red-band-ink)]" />
          <span className="text-[19px] leading-6 font-bold">
            Red flag{redAt ? ` at ${clockFor(Date.parse(redAt.ts))}` : ''}. {agentOf(redFlag.adapter, redFlag.host, redFlag.model).code} was {redFlag.endedBy === 'killed' ? 'stopped mid-stint' : 'out with a failure'}.
          </span>
          <span className="text-[14px]">
            Car {carNumber(t.id)} keeps its place. {stopName ? `Packet ${stopName} was built from the log, so the next driver starts from it.` : 'The daemon builds a packet from the log.'}
          </span>
        </div>
      ) : null}
      {header}
      <div className="px-4 sm:px-6">
        <StintChart events={events} runs={bundle.runs} review={bundle.review} done={t.status === 'done'} asOf={asOf} atSeq={atSeq} onAsOf={setMoment} onOpenPacket={openPacket} />
      </div>
      <div
        className={cx(
          'grid grid-cols-1 gap-y-8 px-4 sm:px-6 pt-6 pb-8',
          railOpen ? 'lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_340px]' : 'lg:grid-cols-[minmax(0,1fr)_340px]',
        )}
      >
        {railOpen ? <div className="lg:pr-6 lg:border-r border-rule min-w-0">{rail}</div> : null}
        <div className={cx('min-w-0', railOpen ? 'lg:pl-6 xl:pr-6' : 'lg:pr-6')}>{work}</div>
        {/* on a phone the column stacks; when the car needs a call it goes above the work, so the flag is not thousands of pixels down */}
        <div className={cx('min-w-0', (then.task.status === 'awaiting_approval' || redFlag) && 'max-lg:order-first', railOpen ? 'lg:col-span-2 xl:col-span-1 xl:pl-6 xl:border-l border-rule' : 'lg:pl-6 lg:border-l border-rule')}>{side}</div>
      </div>
    </main>
  );
}

/**
 * The car as it stood at a moment: its status, its runs, its last verification, review and merge, from the events seen by then.
 * The bundle is the car now; null is now.
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

/** The car's state in race words, with a plain line under it that says what is happening. */
function carState(b: TaskBundle, packetName: string | null): { tone: ChipTone; label: string; detail: string } {
  const t = b.task;
  const live = b.runs.find((r) => !r.endedAt);
  const v = b.verification;
  const lastBuild = b.runs.filter((r) => r.role === 'implementer').at(-1);
  if (t.status === 'done') return { tone: 'merged', label: 'Took the flag', detail: `Approved by ${!b.merge?.by || b.merge.by === 'human' ? 'you' : b.merge.by} and merged.` };
  if (t.status === 'awaiting_approval') return { tone: 'warn', label: 'Your call', detail: v ? 'Waiting for you at the flag.' : 'Waiting at the flag; not verified yet.' };
  if (t.status === 'rejected') return { tone: 'bad', label: 'Rejected', detail: 'Rejected at the gate. Hand it on with the reason, or leave it parked.' };
  if (live) {
    const a = agentOf(live.adapter, live.host, live.model);
    return { tone: 'good', label: `${a.code} on track`, detail: `${a.name} ${live.run} ${ROLE_NAMES[live.role ?? ''] ?? 'runs'} in its worktree.` };
  }
  if (lastBuild && (lastBuild.endedBy === 'killed' || lastBuild.endedBy === 'failed')) {
    const a = agentOf(lastBuild.adapter, lastBuild.host, lastBuild.model);
    return { tone: 'bad', label: 'Stopped', detail: `${a.name} ${lastBuild.run} ${lastBuild.endedBy === 'killed' ? 'was stopped' : 'failed'}${packetName ? `; packet ${packetName} was built anyway` : ''}.` };
  }
  if (t.status === 'verifying') return { tone: 'good', label: 'Verifying', detail: 'The daemon runs the tests in the worktree.' };
  if (t.status === 'reviewing') return { tone: 'good', label: 'Reviewing', detail: 'A review is offered only after a green verify.' };
  if (t.status === 'in_review') return { tone: 'warn', label: 'In review', detail: 'A pull request waits; the task finishes when it merges.' };
  if (t.status === 'planned') return { tone: 'neutral', label: 'On the grid', detail: b.plan ? 'Planned, waiting for a driver.' : 'Waiting for a plan and a driver.' };
  return { tone: 'neutral', label: 'In the pits', detail: 'Waiting for the next driver.' };
}

/** A packet's size as the daemon counted it when it was built, from its handoff.created event. */
function packetMeta(events: StintEvent[], name: string | null): { tokens: number | null; bytes: number | null } {
  const e = name ? events.find((x) => x.type === 'handoff.created' && x.payload.name === name) : undefined;
  return { tokens: e ? Number(e.payload.tokens) || null : null, bytes: e ? Number(e.payload.bytes) || null : null };
}

export function Placeholder({ title, children }: { title: string; children: string }) {
  return (
    <main className="flex-1 p-6">
      <h1 className="text-[19px] font-bold stretch-112 mb-2">{title}</h1>
      <EmptyState>{children}</EmptyState>
    </main>
  );
}
