import type { Handoff } from '@stint-dev/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useParams, useSearchParams } from 'react-router';
import { agentOf } from '../agents';
import { api } from '../api';
import { ApprovalGate } from '../components/ApprovalGate';
import { HandoffCard, PlanCard, ReviewCard } from '../components/Cards';
import { DiffView } from '../components/DiffView';
import { HandTo } from '../components/HandTo';
import { MemoryPanel } from '../components/MemoryPanel';
import { PacketSources } from '../components/PacketSources';
import { PermissionBanner } from '../components/Permissions';
import { QuizPanel } from '../components/Quiz';
import { Terminal } from '../components/Terminal';
import { FilesTab } from '../components/Files';
import { VerificationTab } from '../components/Verification';
import { WhoContinues } from '../components/WhoContinues';
import { Rail } from '../components/Rail';
import { Button, CostMeter, EmptyState, StatusChip, cx } from '../components/ui';
import { useEvents, useTask } from '../hooks';

const GRAPH_EVENTS = new Set(['run.finished', 'decision.recorded', 'review.recorded', 'skill.applied', 'skill.approved', 'approval.granted', 'approval.rejected', 'merge.completed', 'human.command']);

export const TABS = ['diff', 'files', 'terminal', 'plan', 'packet', 'review', 'verification'] as const;
export type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = { diff: 'Diff', files: 'Files', terminal: 'Terminal', plan: 'Plan', packet: 'Packet', review: 'Review', verification: 'Verification' };

function useWide(): boolean {
  const [wide, setWide] = useState(() => matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = matchMedia('(min-width: 1024px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export function TaskView({ memoryOpen }: { memoryOpen: boolean }) {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: bundle, error, reload } = useTask(id);
  const { events } = useEvents(id);
  const [showAll, setShowAll] = useState(false);
  const wide = useWide();
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      if (e.key === 'd') setTab('diff');
      else if (e.key === 't') setTab('terminal');
      else if (e.key === 'h') setTab('packet');
      else if (e.key === 'j' || e.key === 'k') {
        const seqs = events.map((x) => x.seq);
        const i = selected === null ? -1 : seqs.indexOf(selected);
        const next = e.key === 'j' ? seqs[Math.min(seqs.length - 1, i + 1)] : seqs[Math.max(0, i - 1)];
        if (next !== undefined) setParam('ev', String(next));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [events, selected, setParam, setTab]);
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
  const graphVersion = useMemo(() => events.filter((e) => GRAPH_EVENTS.has(e.type)).length, [events]);
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
      .catch(() => undefined)
      .finally(() => setAutoBusy(false));
  };

  if (error) return <p className="p-4 text-bad">This task could not be read: {error}</p>;
  if (!bundle) return <p className="p-4 text-faint">Reading the task.</p>;
  const t = bundle.task;

  const live = bundle.runs.find((r) => !r.endedAt);
  const agentsUsed = new Set(bundle.runs.filter((r) => r.role === 'implementer').map((r) => r.adapter));
  const holder = t.status === 'awaiting_approval' ? 'You, at the gate' : t.status === 'done' ? `Merged by ${!bundle.merge?.by || bundle.merge.by === 'human' || bundle.merge.by === 'you' ? 'you' : bundle.merge.by === 'policy' ? 'the auto-approve lane' : bundle.merge.by}` : live ? `${agentOf(live.adapter, live.host, live.model).name}, ${live.run}` : 'Nobody yet';
  const v = bundle.verification;
  const header = (
    <header className="shrink-0 border-b border-line px-6 py-4 flex flex-wrap gap-x-10 gap-y-4" data-testid="task-header">
      <div className="min-w-0 flex-1 basis-[520px]">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span className="font-mono">{t.id}</span>
          <StatusChip status={t.status} />
          <span>
            branch <span className="font-mono">{t.branch}</span>, base <span className="font-mono">{t.baseCommit.slice(0, 7)}</span>
          </span>
          {t.status !== 'done' ? (
            <Button
              className={cx('h-7 ml-auto', autopilot.on && 'border-accent text-accent')}
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
        <h1 className="mt-1.5 text-[26px] leading-[32px] font-semibold tracking-[-0.02em]">{t.title}</h1>
        <p className="mt-1.5 text-[13px] text-muted max-w-[80ch]">{t.goal}</p>
        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Acceptance criteria" data-testid="header-acceptance">
          {t.acceptance.map((a) => (
            <li key={a} className="rounded-md border border-line bg-raised px-2 py-0.5 text-[12px]">
              {a}
            </li>
          ))}
        </ul>
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-[12px] self-start" data-testid="task-summary">
        <dt className="text-muted">Task total</dt>
        <dd className="font-semibold" data-testid="task-cost">
          <CostMeter cost={bundle.cost} />
        </dd>
        <dt className="text-muted">Runs and hops</dt>
        <dd className="tabular">
          {bundle.runs.length} run{bundle.runs.length === 1 ? '' : 's'}, {agentsUsed.size} agent{agentsUsed.size === 1 ? '' : 's'}, {handoffCount} packet{handoffCount === 1 ? '' : 's'}
        </dd>
        <dt className="text-muted">Holder</dt>
        <dd>{holder}</dd>
        <dt className="text-muted">Tests</dt>
        <dd className="tabular">{v ? `${v.passed} passed${v.failed ? `, ${v.failed} failed` : ''}${v.tamper === null ? ', unchanged' : ''}, by the daemon` : 'not run yet'}</dd>
        <dt className="text-muted">Test command</dt>
        <dd className="font-mono truncate max-w-[28ch]">{t.testCommand}</dd>
      </dl>
    </header>
  );

  const rail = (
    <div className="h-full flex flex-col min-h-0" data-testid="rail-column">
      <div className="px-4 pt-3 pb-2 border-b border-line">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Timeline</h2>
          <span className="flex items-center gap-2 text-[12px] text-muted">
            <span className="tabular">{events.length} events</span>
            <Button className="h-6 px-2 text-[12px]" onClick={() => setShowAll((s) => !s)} aria-pressed={showAll} data-testid="show-all">
              {showAll ? 'Show what matters' : 'Show all'}
            </Button>
          </span>
        </div>
        {autopilot.text ? (
          <p className="mt-2 text-[12px] text-muted" data-testid="autopilot-step">
            {autopilot.text}
          </p>
        ) : null}
        <div className="mt-2">
          <PermissionBanner permissions={pendingPermissions.filter((p) => p.run === (bundle.runs.find((r) => !r.endedAt)?.run ?? p.run))} />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <Rail events={events} runs={bundle.runs} showAll={showAll} selected={selected} onSelect={(s) => setParam('ev', String(s))} onOpenPacket={(name) => {
            setParam('packet', name);
            setTab('packet');
          }} />
      </div>
      <WhoContinues bundle={bundle} onChoose={() => setTab('packet')} />
      <ApprovalGate bundle={bundle} onDone={reload} />
    </div>
  );

  const work = (
    <div className="h-full flex flex-col min-h-0">
      <div role="tablist" aria-label="Work area" className="flex gap-1 px-3 pt-3 border-b border-line overflow-x-auto">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            data-testid={`tab-${k}`}
            onClick={() => setTab(k)}
            className={cx('h-8 px-3 -mb-px border-b-2 text-[13px] whitespace-nowrap', tab === k ? 'border-accent text-ink font-medium' : 'border-transparent text-muted hover:text-ink')}
          >
            {TAB_NAMES[k]}
          </button>
        ))}
      </div>
      {/* focusable, so a keyboard can scroll it */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4" role="tabpanel" aria-label={TAB_NAMES[tab]} tabIndex={0}>
        {tab === 'diff' ? <DiffView taskId={t.id} version={diffVersion} /> : null}
        {tab === 'files' ? <FilesTab taskId={t.id} /> : null}
        {tab === 'terminal' ? <Terminal taskId={t.id} liveRun={bundle.runs.find((r) => !r.endedAt)?.run ?? null} /> : null}
        {tab === 'plan' ? <PlanCard plan={bundle.plan} /> : null}
        {tab === 'packet' ? (
          <div className="flex flex-col gap-3">
            {packetNames.length > 1 ? (
              <div className="flex items-center gap-1" role="group" aria-label="Packets">
                {packetNames.map((n) => (
                  <Button key={n} className={cx('h-7', (packetName ?? packetNames.at(-1)) === n && 'border-accent text-accent')} onClick={() => setParam('packet', n)}>
                    {n}
                  </Button>
                ))}
                <span className="text-[12px] text-faint ml-2">every run that ended left one</span>
              </div>
            ) : null}
            <HandoffCard handoff={packetName ? packet : bundle.handoff} />
            {t.status !== 'done' ? <HandTo taskId={t.id} packet={packetName ? packet : bundle.handoff} live={bundle.runs.some((r) => !r.endedAt)} /> : null}
            {packetNames.length ? <PacketSources taskId={t.id} name={packetName ?? (packetNames.at(-1) as string)} events={events} onSelect={(seq) => setParam('ev', String(seq))} /> : null}
            {packetNames.length ? <QuizPanel taskId={t.id} name={packetName ?? (packetNames.at(-1) as string)} events={events} /> : null}
          </div>
        ) : null}
        {tab === 'review' ? <ReviewCard review={bundle.review} /> : null}
        {tab === 'verification' ? <VerificationTab taskId={t.id} acceptance={t.acceptance} live={bundle.runs.some((r) => !r.endedAt)} onChanged={reload} /> : null}
      </div>
    </div>
  );

  const memory = (
    <MemoryPanel
      id={t.id}
      asOf={params.get('asOf')}
      setAsOf={(v) => setParam('asOf', v)}
      version={graphVersion}
      onOpenFile={(path) => {
        setTab('diff');
        setTimeout(() => document.getElementById(`diff-${path}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      }}
    />
  );

  if (!wide) {
    return (
      <main className="flex-1 min-h-0 overflow-y-auto flex flex-col" data-testid="task-view">
        {header}
        <div className="min-h-[60vh]">{rail}</div>
        <div className="border-t border-line">{work}</div>
        {memoryOpen ? memory : null}
      </main>
    );
  }
  return (
    <main className="flex-1 min-h-0 flex flex-col" data-testid="task-view">
      {header}
      <Group orientation="horizontal" className="flex-1 min-h-0">
        <Panel defaultSize="320px" minSize="260px" maxSize="520px">
          {rail}
        </Panel>
        <Separator className="w-px" />
        <Panel minSize="360px">{work}</Panel>
        {memoryOpen ? (
          <>
            <Separator className="w-px" />
            <Panel defaultSize="360px" minSize="280px" maxSize="560px">
              {memory}
            </Panel>
          </>
        ) : null}
      </Group>
    </main>
  );
}

export function Placeholder({ title, children }: { title: string; children: string }) {
  return (
    <main className="flex-1 p-6">
      <h1 className="text-[20px] font-semibold mb-2">{title}</h1>
      <EmptyState>{children}</EmptyState>
    </main>
  );
}
