import type { Handoff } from '@stint-dev/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useParams, useSearchParams } from 'react-router';
import { api } from '../api';
import { ApprovalGate } from '../components/ApprovalGate';
import { HandoffCard, PlanCard, ReviewCard, VerificationCard } from '../components/Cards';
import { DiffView } from '../components/DiffView';
import { Rail } from '../components/Rail';
import { Button, CostMeter, EmptyState, StatusChip, cx } from '../components/ui';
import { useEvents, useTask } from '../hooks';

export const TABS = ['diff', 'terminal', 'plan', 'packet', 'review', 'verification'] as const;
export type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = { diff: 'Diff', terminal: 'Terminal', plan: 'Plan', packet: 'Packet', review: 'Review', verification: 'Verification' };

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

  if (error) return <p className="p-4 text-bad">This task could not be read: {error}</p>;
  if (!bundle) return <p className="p-4 text-faint">Reading the task.</p>;
  const t = bundle.task;

  const rail = (
    <div className="h-full flex flex-col min-h-0" data-testid="rail-column">
      <div className="px-4 pt-4 pb-2 border-b border-line">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-[15px] font-semibold leading-5">{t.title}</h1>
          <StatusChip status={t.status} />
        </div>
        <div className="mt-1 flex items-center gap-3 text-[12px] text-muted">
          <span className="font-mono">{t.id}</span>
          <span data-testid="task-cost">
            Task total <CostMeter cost={bundle.cost} />
          </span>
          <span className="tabular">{events.length} events</span>
        </div>
        <div className="mt-2 flex gap-2">
          <Button className="h-7" onClick={() => setShowAll((s) => !s)} aria-pressed={showAll} data-testid="show-all">
            {showAll ? 'Show what matters' : 'Show all'}
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <Rail events={events} runs={bundle.runs} showAll={showAll} selected={selected} onSelect={(s) => setParam('ev', String(s))} onOpenPacket={(name) => {
            setParam('packet', name);
            setTab('packet');
          }} />
      </div>
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
      <div className="flex-1 min-h-0 overflow-y-auto p-4" role="tabpanel">
        {tab === 'diff' ? <DiffView taskId={t.id} version={diffVersion} /> : null}
        {tab === 'terminal' ? <EmptyState testId="empty-terminal">A shell in the run's worktree opens here once the task has a worktree. The terminal arrives in R-008.</EmptyState> : null}
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
          </div>
        ) : null}
        {tab === 'review' ? <ReviewCard review={bundle.review} /> : null}
        {tab === 'verification' ? <VerificationCard v={bundle.verification} onRerun={() => void api.verify(t.id).then(reload).catch(() => reload())} /> : null}
      </div>
    </div>
  );

  const memory = (
    <aside className="h-full overflow-y-auto p-4 border-l border-line" aria-label="Memory" data-testid="memory-panel">
      <h2 className="text-[13px] font-semibold mb-2">Memory</h2>
      <EmptyState testId="empty-memory">Similar past tasks, the decisions that constrain this task and the files that change together appear here. The memory graph arrives in R-018.</EmptyState>
    </aside>
  );

  if (!wide) {
    return (
      <main className="flex-1 min-h-0 overflow-y-auto flex flex-col" data-testid="task-view">
        <div className="min-h-[60vh]">{rail}</div>
        <div className="border-t border-line">{work}</div>
        {memoryOpen ? memory : null}
      </main>
    );
  }
  return (
    <main className="flex-1 min-h-0" data-testid="task-view">
      <Group orientation="horizontal" className="h-full">
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
