import type { Handoff } from '@stint-dev/core';
import { useState } from 'react';
import { ROLE_NAMES, agentOf, modelName } from '../agents';
import { type AdapterHealth, api, daemonMessage } from '../api';
import { useHealth } from '../hooks';
import { useHold } from './Scrubber';
import { Button, Explain, StatusChip, Who, cx } from './ui';

/** How closely Stint watches the agent's actions, by its gate strength. */
const GATE: Record<AdapterHealth['gate'], string> = {
  enforced: 'Stint checks each action before it happens.',
  observed: 'Stint watches each action and checks the result after.',
  none: 'Stint does not check its actions.',
};

/** How the leaving run ended, as a clause after "which". */
const ENDED: Record<string, string> = { completed: 'finished', killed: 'was killed', failed: 'failed', capped: 'hit its spending cap', handed: 'handed it on' };

const VENDOR_NAMES: Record<string, string> = { meta: 'Meta', anthropic: 'Anthropic', openai: 'OpenAI', local: 'Local', other: 'Other' };
export const vendorLabel = (vendor: string) => (vendor ? (VENDOR_NAMES[vendor] ?? `${vendor.charAt(0).toUpperCase()}${vendor.slice(1)}`) : 'Vendor unknown');

/** What this agent can do, in the words health reports: resume, structured output, sandbox, cost reporting. */
function capabilityNote(caps: AdapterHealth['capabilities']): string {
  if (!caps) return 'Not reported: whether it can resume, gives structured output, runs in a sandbox or reports its cost.';
  const parts = [
    caps.resume ? 'can resume a stopped session' : 'cannot resume a stopped session',
    caps.schemaOutput ? 'gives structured output' : 'no structured output',
    caps.sandbox ? 'runs in a sandbox' : 'no sandbox',
    caps.costReporting ? 'reports its cost' : 'does not report its cost',
  ];
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
  const hold = useHold();
  const choice = picked && ready.some((a) => a.id === picked) ? picked : (recommended?.id ?? null);
  if (!packet || all.length === 0) return null;
  const hand = () => {
    if (!choice || busy) return;
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
          className={cx('grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 p-3 rounded-[5px] border', selectable ? 'cursor-pointer' : 'text-ink-2', chosen ? 'border-ink bg-surface-selected' : 'border-rule')}
          data-testid={disabled ? 'hand-disabled' : undefined}
        >
          <input type="radio" name="hand-to" value={a.id} checked={chosen} disabled={!selectable} onChange={() => setPicked(a.id)} className="mt-[3px]" />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <Who agent={agentOf(a.id)} className="font-semibold text-ink" />
              <span className="flex flex-wrap gap-1">
                {a.id === recommended?.id ? <StatusChip label="recommended" tone="recommend" /> : null}
                {a.id === leaving ? <StatusChip label="leaving" tone="neutral" /> : null}
                {disabled ? <StatusChip label="disabled" tone="neutral" /> : null}
                {!disabled && !selectable ? <StatusChip label="unavailable" tone="neutral" /> : null}
              </span>
            </span>
            <span className="flex flex-wrap gap-x-2 text-small text-ink-2">
              <span data-testid="hand-vendor">{vendorLabel(a.vendor)}</span>
              <span data-testid="hand-roles">{a.roles.map((r) => ROLE_NAMES[r] ?? r).join(', ')}</span>
            </span>
            {/* the detail of the chosen row only; the others keep it for a screen reader's row name */}
            <span className={cx('text-small text-ink-2', !chosen && 'sr-only')} data-testid="capability-note">
              {capabilityNote(a.capabilities)}
            </span>
            {/* a turned-off row says so in its chip; the line stays for a screen reader's row name */}
            <span className={cx('text-small text-ink-2', !chosen && 'sr-only')} data-testid="hand-gate">
              {disabled ? 'Turned off in config' : GATE[a.gate]}
            </span>
          </span>
        </label>
      </li>
    );
  };
  const picker = (
    <>
      <fieldset className="relative m-0 p-0 border-0 flex flex-col gap-2 min-w-0">
        <legend className="pb-1 text-section">Hand to the next agent</legend>
        <Explain word="handoff" className="mb-1" />
        {recommended && recommended.id !== leaving && leaving ? (
          <p className="text-small text-ink-2" data-testid="hand-reason">
            Recommended: {agentOf(recommended.id).name}, a different agent from {agentOf(leaving).name}, which {ENDED[packet.from.endedBy] ?? `ended ${packet.from.endedBy}`}. It runs on a different program
            {harnessOf(recommended) !== recommended.id ? ` (${harnessOf(recommended)})` : ''}
            {recommended.model && recommended.model !== packet.from.model ? ` and model (${modelName(recommended.model)})` : ''}.
          </p>
        ) : null}
        {/* the group role sits on a wrapper: on the ul itself it would replace the list role its items need */}
        <div role="radiogroup" aria-label="Next agent">
          <ul className="flex flex-col gap-2">{all.filter((a) => a.enabled !== false).map(row)}</ul>
        </div>
        {off.length ? (
          <details className="text-small text-ink-2">
            <summary className="w-fit min-h-6 cursor-pointer hover:text-ink">
              {off.length} more {off.length === 1 ? 'is' : 'are'} turned off in config
            </summary>
            <ul className="mt-2 flex flex-col gap-2">{off.map(row)}</ul>
          </details>
        ) : null}
      </fieldset>
      <label className="flex flex-col gap-1.5" htmlFor="hand-ask">
        <span className="text-small text-ink-2">Anything to add for the next agent (optional)</span>
        <textarea id="hand-ask" rows={3} value={ask} placeholder="What the packet does not say" onChange={(e) => setAsk(e.target.value)} className="stint-input min-h-0 px-2.5 py-2" />
      </label>
      <div className="flex flex-col gap-2">
        <Button tone="primary" className="self-start" onClick={hand} disabled={busy || live || !choice} aria-busy={busy} data-testid="hand-button" {...hold}>
          {busy ? 'Handing over' : `Hand to ${choice ? agentOf(choice).name : 'an agent'}`}
        </Button>
        {live ? <span className="text-ink-2">A run is going; stop it first.</span> : null}
        {sent ? (
          <span className="text-ink" role="status">
            {sent}
          </span>
        ) : null}
        <p className="text-small text-ink-2">It reads this packet, the plan, the skills and the change so far; never the last agent's whole conversation.</p>
        {choice ? <p className="font-mono text-small text-ink-3">stint hand {taskId} {choice}</p> : null}
      </div>
      {error ? (
        <p className="text-red" role="alert">
          The hand-off did not start: {error}
        </p>
      ) : null}
    </>
  );
  return (
    <section className="flex flex-col gap-4 max-w-[760px] pt-3 border-t border-rule-strong" data-testid="hand-to">
      {atGate ? (
        // at the gate the call is approve or not; a different agent is the exception, one click away
        <details className="flex flex-col gap-3">
          <summary className="w-fit min-h-6 cursor-pointer font-semibold hover:underline underline-offset-4">Change who continues instead</summary>
          <div className="mt-3 flex flex-col gap-4">{picker}</div>
        </details>
      ) : (
        picker
      )}
    </section>
  );
}
