import { useState } from 'react';
import { agentOf } from '../agents';
import { DaemonError, type TaskBundle, api } from '../api';
import { useHealth } from '../hooks';
import { useHold } from './Scrubber';
import { Button, Kbd, StatusChip, Who } from './ui';

/**
 * After a run is killed or fails, the task view says who should pick the task up: a different agent from the one
 * that stopped, ready now, from the packet the daemon built. One click hands it over; the packet tab has the rest.
 */
export function WhoContinues({ bundle, onChoose }: { bundle: TaskBundle; onChoose: () => void }) {
  const { data: health } = useHealth();
  const [state, setState] = useState<{ busy: boolean; said: string | null }>({ busy: false, said: null });
  const hold = useHold();
  const last = bundle.runs.filter((r) => r.role === 'implementer').at(-1);
  const live = bundle.runs.some((r) => !r.endedAt);
  if (!last || live || bundle.task.status === 'done' || !bundle.handoff || (last.endedBy !== 'killed' && last.endedBy !== 'failed')) return null;
  const leaving = last.adapter;
  const ready = (health?.adapters ?? []).filter((a) => a.id !== 'replay' && a.roles.includes('implementer') && a.enabled !== false && a.capability.level === 'supported');
  const next = ready.find((a) => a.id !== leaving) ?? null;
  const hand = () => {
    if (!next || state.busy) return;
    setState({ busy: true, said: null });
    api
      .hand(bundle.task.id, next.id)
      .then((r) => setState({ busy: false, said: `${agentOf(next.id).name} started ${r.run} from the packet.` }))
      .catch((e: unknown) => setState({ busy: false, said: e instanceof DaemonError ? e.error.message : String(e) }));
  };
  return (
    <section className="flex flex-col gap-3" data-testid="who-continues" aria-labelledby="who-continues-title">
      <div>
        <h2 id="who-continues-title" className="text-section">
          Who continues
        </h2>
        <p className="mt-1 text-small text-ink-2">The next agent reads the packet {last.run} left, the plan, the skills list and the diff. Never the transcript.</p>
      </div>
      {next ? (
        <div className="flex flex-col gap-1 p-3 rounded-[5px] border border-rule-strong bg-panel">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <Who agent={agentOf(next.id)} className="font-semibold" />
            <StatusChip label="recommended" tone="recommend" />
          </span>
          <p className="text-small text-ink-2">
            Recommended: {agentOf(next.id).name}. A different agent from {agentOf(leaving).name}, which {last.endedBy === 'killed' ? 'was killed' : 'failed'}; it reads only the packet.
          </p>
        </div>
      ) : (
        <p>No other agent is ready to take over from {agentOf(leaving).name}. Turn one on, or hand it back from the packet tab.</p>
      )}
      {next ? (
        <Button tone="primary" className="self-start" onClick={hand} disabled={state.busy} aria-busy={state.busy} data-testid="who-continues-hand" {...hold}>
          {state.busy ? 'Handing over' : `Hand to ${agentOf(next.id).name}`}
        </Button>
      ) : null}
      <button type="button" className="self-start text-small text-ink-2 underline decoration-rule-strong hover:text-ink hover:decoration-ink" onClick={onChoose}>
        Pick another agent <Kbd>h</Kbd>
      </button>
      {state.said ? <p className="text-ink-2">{state.said}</p> : null}
    </section>
  );
}
