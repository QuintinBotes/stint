import { useState } from 'react';
import { agentOf } from '../agents';
import { DaemonError, type TaskBundle, api } from '../api';
import { useHealth } from '../hooks';
import { Button, Kbd, VendorMark } from './ui';

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
    <section className="flex flex-col gap-3 text-[14px] leading-5" data-testid="who-continues" aria-label="Change driver">
      <h2 className="text-[14px] leading-5 font-bold">Change driver</h2>
      <div className="flex items-center gap-3">
        {next ? <VendorMark agent={agentOf(next.id)} showName={false} size={22} /> : null}
        <p className="text-ink">
          {next
            ? `Recommended: ${agentOf(next.id).name}. A different agent from ${agentOf(leaving).name}, which ${last.endedBy === 'killed' ? 'was killed' : 'failed'}; it reads only the packet.`
            : `No other agent is ready to take over from ${agentOf(leaving).name}. Turn one on, or hand it back from the packet tab.`}
        </p>
      </div>
      {next ? (
        <Button tone="primary" className="h-11 w-full justify-between px-4 text-[14px]" onClick={hand} disabled={state.busy} data-testid="who-continues-hand">
          Hand to {agentOf(next.id).name}
        </Button>
      ) : null}
      <button type="button" className="self-start text-ink-2 underline-offset-2 hover:text-ink hover:underline" onClick={onChoose}>
        Pick another driver <Kbd>h</Kbd>
      </button>
      {state.said ? <p className="text-ink-2">{state.said}</p> : null}
    </section>
  );
}
