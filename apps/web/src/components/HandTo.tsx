import type { Handoff } from '@stint-dev/core';
import { useState } from 'react';
import { agentOf, modelName } from '../agents';
import { type AdapterHealth, DaemonError, api } from '../api';
import { useHealth } from '../hooks';
import { Button, StatusChip, VendorMark, cx } from './ui';

const GATE: Record<string, string> = {
  enforced: "Stint checks every tool call it makes",
  observed: 'Stint watches what it does and verifies after',
  none: 'no gate',
};

const vendorLabel = (vendor: string) => (vendor ? `${vendor.charAt(0).toUpperCase()}${vendor.slice(1)}` : 'Vendor unknown');

/** What this agent can do, in the words health reports: resume, structured output, sandbox, cost reporting. */
function capabilityNote(caps: AdapterHealth['capabilities']): string {
  if (!caps) return 'Capabilities not reported: resume, structured output, sandbox and cost reporting unknown.';
  const parts = [caps.resume ? 'can resume' : 'no resume', caps.schemaOutput ? 'structured output' : 'no structured output', caps.sandbox ? 'sandboxed' : 'no sandbox', caps.costReporting ? 'reports cost' : 'no cost reporting'];
  return `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.`;
}

const harnessOf = (a: AdapterHealth) => a.harness ?? a.id;

/**
 * Hand the task to the next agent from this packet: enabled agents can be picked, disabled ones are marked.
 * The recommendation compares harness and model (ADR-0006): a different agent from the one leaving, on a
 * different harness and model where one is ready; each agent's vendor stays visible so a person can choose.
 */
export function HandTo({ taskId, packet, live }: { taskId: string; packet: Handoff | null; live: boolean }) {
  const { data: health } = useHealth();
  const leaving = packet?.from.adapter ?? null;
  const all = (health?.adapters ?? []).filter((a) => a.id !== 'replay' && a.roles.includes('implementer'));
  const ready = all.filter((a) => a.enabled !== false && a.capability.level === 'supported');
  const leavingHealth = leaving ? all.find((a) => a.id === leaving) : undefined;
  const leavingHarness = leavingHealth ? harnessOf(leavingHealth) : leaving;
  const recommended =
    ready.find((a) => a.id !== leaving && harnessOf(a) !== leavingHarness && (a.model ?? null) !== (packet?.from.model ?? null)) ?? ready.find((a) => a.id !== leaving) ?? ready[0] ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const choice = picked && ready.some((a) => a.id === picked) ? picked : (recommended?.id ?? null);
  if (!packet || all.length === 0) return null;
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
          Recommended: {agentOf(recommended.id).name}, a different agent from {agentOf(leaving).name}, which ended {packet.from.endedBy}. It runs on a different harness
          {harnessOf(recommended) !== recommended.id ? ` (${harnessOf(recommended)})` : ''}
          {recommended.model && recommended.model !== packet.from.model ? ` and a different model (${modelName(recommended.model)})` : ''}. A fresh agent reads only the packet, so nothing the last one assumed carries over unchecked.
        </p>
      ) : null}
      <ul className="mt-3 flex flex-col gap-1.5" role="radiogroup" aria-label="Next agent">
        {all.map((a) => {
          const disabled = a.enabled === false;
          const selectable = ready.some((r) => r.id === a.id);
          return (
            <li key={a.id} data-testid="hand-agent" data-agent={a.id}>
              <label
                className={cx('flex items-start gap-3 rounded-md border px-3 py-2 text-[13px]', selectable ? 'cursor-pointer' : 'opacity-60', choice === a.id ? 'border-accent' : 'border-line')}
                data-testid={disabled ? 'hand-disabled' : undefined}
              >
                <input type="radio" name="hand-to" value={a.id} checked={choice === a.id} disabled={!selectable} onChange={() => setPicked(a.id)} className="accent-[var(--accent)] mt-0.5" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <VendorMark agent={agentOf(a.id)} />
                    <span className="text-[12px] text-muted" data-testid="hand-vendor">
                      {vendorLabel(a.vendor)}
                    </span>
                    <span className="text-[12px] text-muted" data-testid="hand-roles">
                      {a.roles.join(', ')}
                    </span>
                  </span>
                  <span className="text-[12px] text-muted" data-testid="capability-note">
                    {capabilityNote(a.capabilities)}
                  </span>
                  <span className="text-[12px] text-muted" data-testid="hand-gate">
                    {disabled ? 'Turned off in config' : `Gate: ${a.gate}. ${GATE[a.gate] ?? a.gate}.`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {a.id === recommended?.id ? <StatusChip label="recommended" tone="active" /> : null}
                  {a.id === leaving ? <StatusChip label="leaving" tone="neutral" /> : null}
                  {disabled ? <StatusChip label="disabled" tone="neutral" /> : null}
                  {!disabled && !selectable ? <StatusChip label="unavailable" tone="neutral" /> : null}
                </span>
              </label>
            </li>
          );
        })}
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
