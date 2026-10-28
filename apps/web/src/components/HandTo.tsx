import type { Handoff } from '@stint-dev/core';
import { useState } from 'react';
import { agentOf, modelName } from '../agents';
import { type AdapterHealth, api, daemonMessage } from '../api';
import { useHealth } from '../hooks';
import { Button, StatusChip, VendorMark, cx } from './ui';

const GATE: Record<string, string> = {
  enforced: "Stint checks every tool call it makes",
  observed: 'Stint watches what it does and verifies after',
  none: 'no gate',
};

const VENDOR_NAMES: Record<string, string> = { meta: 'Meta', anthropic: 'Anthropic', openai: 'OpenAI', local: 'Local', other: 'Other' };
export const vendorLabel = (vendor: string) => (vendor ? (VENDOR_NAMES[vendor] ?? `${vendor.charAt(0).toUpperCase()}${vendor.slice(1)}`) : 'Vendor unknown');

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
export function HandTo({ taskId, packet, live, atGate = false }: { taskId: string; packet: Handoff | null; live: boolean; atGate?: boolean }) {
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
      .catch((e: unknown) => setError(daemonMessage(e)))
      .finally(() => setBusy(false));
  };
  const off = all.filter((a) => a.enabled === false);
  const row = (a: AdapterHealth) => {
    const disabled = a.enabled === false;
    const selectable = ready.some((r) => r.id === a.id);
    const chosen = choice === a.id;
    return (
      <li key={a.id} data-testid="hand-agent" data-agent={a.id}>
        <label
          className={cx('grid grid-cols-[20px_minmax(0,1fr)_auto] gap-x-3 items-start py-2 border-b border-rule text-[14px] leading-5', selectable ? 'cursor-pointer' : 'text-ink-2', chosen && 'bg-panel')}
          data-testid={disabled ? 'hand-disabled' : undefined}
        >
          <input type="radio" name="hand-to" value={a.id} checked={chosen} disabled={!selectable} onChange={() => setPicked(a.id)} className="mt-1" />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-2">
              <VendorMark agent={agentOf(a.id)} showName={false} size={14} />
              <span className="font-bold text-ink">{agentOf(a.id).name}</span>
              <span className="text-[12px] text-ink-2" data-testid="hand-vendor">
                {vendorLabel(a.vendor)}
              </span>
              <span className="text-[12px] text-ink-2" data-testid="hand-roles">
                {a.roles.join(', ')}
              </span>
            </span>
            {/* the detail of the chosen row only; the others keep it for a screen reader's row name */}
            <span className={cx('text-[12px] text-ink-2', !chosen && 'sr-only')} data-testid="capability-note">
              {capabilityNote(a.capabilities)}
            </span>
            <span className={cx('text-[12px] text-ink-2', !chosen && !disabled && 'sr-only')} data-testid="hand-gate">
              {disabled ? 'Turned off in config' : `Gate: ${a.gate}. ${GATE[a.gate] ?? a.gate}.`}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {a.id === recommended?.id ? <StatusChip label="recommended" tone="good" /> : null}
            {a.id === leaving ? <StatusChip label="leaving" tone="neutral" /> : null}
            {disabled ? <StatusChip label="disabled" tone="neutral" /> : null}
            {!disabled && !selectable ? <StatusChip label="unavailable" tone="neutral" /> : null}
          </span>
        </label>
      </li>
    );
  };
  const picker = (
    <>
      <fieldset className="m-0 p-0 border-0 flex flex-col min-w-0">
        <legend className="pb-2 text-[14px] font-bold">Who drives next</legend>
        {recommended && recommended.id !== leaving && leaving ? (
          <p className="text-[14px] text-ink-2 pb-2" data-testid="hand-reason">
            Recommended: {agentOf(recommended.id).name}, a different agent from {agentOf(leaving).name}, which ended {packet.from.endedBy}. It runs on a different harness
            {harnessOf(recommended) !== recommended.id ? ` (${harnessOf(recommended)})` : ''}
            {recommended.model && recommended.model !== packet.from.model ? ` and a different model (${modelName(recommended.model)})` : ''}.
          </p>
        ) : null}
        <ul className="flex flex-col border-t border-rule-strong" role="radiogroup" aria-label="Next agent">
          {all.filter((a) => a.enabled !== false).map(row)}
        </ul>
        {off.length ? (
          <details className="mt-2 text-[12px] text-ink-2">
            <summary className="cursor-pointer hover:text-ink">
              {off.length} more {off.length === 1 ? 'is' : 'are'} turned off in config
            </summary>
            <ul className="flex flex-col">{off.map(row)}</ul>
          </details>
        ) : null}
      </fieldset>
      <label className="flex flex-col gap-2" htmlFor="hand-ask">
        <span className="text-[14px] font-bold">
          Add to the board <span className="font-normal text-ink-2">optional</span>
        </span>
        <textarea id="hand-ask" rows={2} value={ask} placeholder="Anything the packet does not say" onChange={(e) => setAsk(e.target.value)} className="w-full rounded-[3px] border border-ink-3 bg-panel px-3 py-2 text-[14px] text-ink placeholder:text-ink-3" />
      </label>
      <div className="flex flex-col gap-2">
        <Button tone="primary" className="h-11 w-full justify-between px-4 text-[14px]" onClick={hand} disabled={busy || live || !choice} data-testid="hand-button">
          {busy ? 'Handing over' : `Send ${choice ? agentOf(choice).name : 'a driver'} out`}
        </Button>
        <span className="text-[12px] text-ink-2">The next driver reads this packet, never the last driver's transcript.</span>
        {live ? <span className="text-[14px] text-ink-2">A run is on track; stop it first.</span> : null}
        {sent ? <span className="text-[14px] text-green">{sent}</span> : null}
      </div>
      {error ? <p className="text-[14px] text-red">The hand-off did not start: {error}</p> : null}
    </>
  );
  return (
    <section className="flex flex-col gap-3" data-testid="hand-to">
      {atGate ? (
        // at the gate the call is approve or not; a new driver is the exception, one click away
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-[14px] font-bold hover:underline underline-offset-2">Change driver instead</summary>
          <div className="mt-3 flex flex-col gap-3">{picker}</div>
        </details>
      ) : (
        picker
      )}
    </section>
  );
}
