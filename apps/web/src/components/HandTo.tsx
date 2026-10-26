import type { Handoff } from '@stint-dev/core';
import { useState } from 'react';
import { agentOf } from '../agents';
import { DaemonError, api } from '../api';
import { useHealth } from '../hooks';
import { Button, StatusChip, VendorMark, cx } from './ui';

const GATE: Record<string, string> = {
  enforced: "Stint checks every tool call it makes",
  observed: 'Stint watches what it does and verifies after',
  none: 'no gate',
};

/** Hand the task to the next agent from this packet: a different agent than the one leaving, when one is ready. */
export function HandTo({ taskId, packet, live }: { taskId: string; packet: Handoff | null; live: boolean }) {
  const { data: health } = useHealth();
  const leaving = packet?.from.adapter ?? null;
  const ready = (health?.adapters ?? []).filter((a) => a.id !== 'replay' && a.roles.includes('implementer') && a.capability.level === 'supported');
  const recommended = ready.find((a) => a.id !== leaving) ?? ready[0] ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const choice = picked ?? recommended?.id ?? null;
  if (!packet || ready.length === 0) return null;
  const hand = () => {
    if (!choice) return;
    setBusy(true);
    setError(null);
    api
      .hand(taskId, choice, ask.trim() || undefined)
      .then((r) => setSent(`${agentOf(choice).name} started ${r.run} from this packet.`))
      .catch((e: unknown) => setError(e instanceof DaemonError ? `${e.error.message}${e.error.hint ? `: ${typeof e.error.hint === 'string' ? e.error.hint : JSON.stringify(e.error.hint)}` : ''}` : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="rounded-lg border border-line bg-raised p-4" data-testid="hand-to">
      <h3 className="text-[13px] font-semibold">Hand to</h3>
      {recommended && recommended.id !== leaving && leaving ? (
        <p className="text-[12px] text-muted mt-1" data-testid="hand-reason">
          Recommended: {agentOf(recommended.id).name}, a different agent from {agentOf(leaving).name}, which ended {packet.from.endedBy}. A fresh agent reads only the packet, so nothing the last one assumed carries over unchecked.
        </p>
      ) : null}
      <ul className="mt-3 flex flex-col gap-1.5" role="radiogroup" aria-label="Next agent">
        {ready.map((a) => (
          <li key={a.id}>
            <label className={cx('flex items-center gap-3 rounded-md border px-3 py-2 text-[13px] cursor-pointer', choice === a.id ? 'border-accent' : 'border-line')}>
              <input type="radio" name="hand-to" value={a.id} checked={choice === a.id} onChange={() => setPicked(a.id)} className="accent-[var(--accent)]" />
              <VendorMark agent={agentOf(a.id)} />
              <span className="text-[12px] text-muted truncate">{GATE[a.gate] ?? a.gate}</span>
              {a.id === recommended?.id ? <StatusChip label="recommended" tone="active" /> : null}
              {a.id === leaving ? <StatusChip label="leaving" tone="neutral" /> : null}
            </label>
          </li>
        ))}
      </ul>
      <label className="block mt-3 text-[12px] text-muted" htmlFor="hand-ask">
        Anything to add to the packet's ask (optional)
      </label>
      <textarea id="hand-ask" rows={2} value={ask} onChange={(e) => setAsk(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface p-2 text-[13px]" />
      <div className="mt-2 flex items-center gap-3">
        <Button tone="primary" onClick={hand} disabled={busy || live || !choice} data-testid="hand-button">
          {busy ? 'Handing' : `Hand to ${choice ? agentOf(choice).name : 'an agent'}`}
        </Button>
        {live ? <span className="text-[12px] text-faint">A run is live; stop it first.</span> : null}
        {sent ? <span className="text-[12px] text-good">{sent}</span> : null}
      </div>
      {error ? <p className="text-[12px] text-bad mt-2">{error}</p> : null}
    </section>
  );
}
