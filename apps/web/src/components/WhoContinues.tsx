import { useState } from 'react';
import { agentOf } from '../agents';
import { DaemonError, type TaskBundle, api } from '../api';
import { useHealth } from '../hooks';
import { Button, Kbd } from './ui';

/**
 * After a run is killed or fails, the timeline says who should pick the task up: a different agent from the one
 * that stopped, ready now, from the packet the daemon built. One click hands it over; the packet tab has the rest.
 */
export function WhoContinues({ bundle, onChoose }: { bundle: TaskBundle; onChoose: () => void }) {
  const { data: health } = useHealth();
  const [state, setState] = useState<{ busy: boolean; said: string | null }>({ busy: false, said: null });
  const last = bundle.runs.filter((r) => r.role === 'implementer').at(-1);
  const live = bundle.runs.some((r) => !r.endedAt);
  if (!last || live || bundle.task.status === 'done' || !bundle.handoff || (last.endedBy !== 'killed' && last.endedBy !== 'failed')) return null;
  const leaving = last.adapter;
  const ready = (health?.adapters ?? []).filter((a) => a.id !== 'replay' && a.roles.includes('implementer') && a.enabled !== false && a.capability.level === 'supported');
  const next = ready.find((a) => a.id !== leaving) ?? null;
  const hand = () => {
    if (!next) return;
    setState({ busy: true, said: null });
    api
      .hand(bundle.task.id, next.id)
      .then((r) => setState({ busy: false, said: `${agentOf(next.id).name} started ${r.run} from the packet.` }))
      .catch((e: unknown) => setState({ busy: false, said: e instanceof DaemonError ? e.error.message : String(e) }));
  };
  return (
    <section className="mx-3 mb-2 rounded-lg border border-line bg-raised p-3 text-[12px]" data-testid="who-continues" aria-label="Who continues">
      <h3 className="text-[13px] font-semibold">Who continues</h3>
      <p className="mt-1 text-muted">
        {next
          ? `Recommended: ${agentOf(next.id).name}. A different agent from ${agentOf(leaving).name}, which ${last.endedBy === 'killed' ? 'was killed' : 'failed'}; it reads only the packet.`
          : `No other agent is ready to take over from ${agentOf(leaving).name}. Turn one on, or hand it back from the packet tab.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {next ? (
          <Button tone="primary" className="h-7" onClick={hand} disabled={state.busy} data-testid="who-continues-hand">
            Hand to {agentOf(next.id).name} <Kbd>h</Kbd>
          </Button>
        ) : null}
        <Button className="h-7" onClick={onChoose}>
          Choose another
        </Button>
      </div>
      {state.said ? <p className="mt-2 text-muted">{state.said}</p> : null}
    </section>
  );
}
