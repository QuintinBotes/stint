import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ADAPTER_NAMES, agentOf, hostName, markColor, modelName } from '../agents';
import type { Health, ModelHealth } from '../api';
import { localTime } from '../format';
import { cx } from './ui';

export type Credit = { host: string; left: number };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" className="sw" style={{ background: color }} />;
}

function Row({ dot, name, detail, off }: { dot: string; name: string; detail?: string; off?: boolean }) {
  return (
    <li className="flex items-start gap-2 py-1">
      <span className="mt-1">
        <Dot color={off ? 'var(--rule-strong)' : dot} />
      </span>
      <span className="min-w-0">
        <span className={cx('text-[14px]', off ? 'text-ink-2' : 'text-ink')}>{name}</span>
        {detail ? <span className="block text-[12px] text-ink-3 break-words">{detail}</span> : null}
      </span>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-rule first:border-t-0 pt-2 first:pt-0 mt-2 first:mt-0">
      <h2 className="text-[12px] font-bold text-ink-2">{title}</h2>
      <ul>{children}</ul>
    </section>
  );
}

/** Each model the routes name, merged by its display name: ready when any host can answer it now. */
function modelRows(models: ModelHealth[]) {
  const byName = new Map<string, ModelHealth[]>();
  for (const m of models) byName.set(modelName(m.model), [...(byName.get(modelName(m.model)) ?? []), m]);
  return [...byName.entries()]
    .map(([name, ms]) => {
      const up = ms.filter((m) => m.ready);
      const first = (up[0] ?? ms[0]) as ModelHealth;
      return {
        name,
        ready: up.length > 0,
        mark: agentOf('openai-compatible', first.host, first.model).mark,
        detail: up.length
          ? `${[...new Set(up.flatMap((m) => m.roles))].join(', ')}, on ${up.map((m) => hostName(m.host)).join(', ')}`
          : [...new Set(ms.map((m) => m.reason).filter(Boolean))].join('; '),
      };
    })
    .sort((a, b) => Number(b.ready) - Number(a.ready));
}

/**
 * The daemon, the agents and the models behind one button. The bar says whether things are ready; the panel says
 * which, and why one is not. It holds any number of agents and models without crowding the bar.
 */
export function StatusMenu({ health, unreachable, credits }: { health: Health | null; unreachable: boolean; credits: Credit[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (!health) {
    // the first health read has not come back yet, or it failed: only the second is worth alarming anyone about
    return unreachable ? (
      <span className="inline-flex shrink-0 items-center gap-2 h-[30px] px-3 rounded-[3px] border border-red text-[14px] font-bold text-red whitespace-nowrap" role="status" data-testid="status-unreachable">
        <Dot color="var(--sw-red)" />
        Daemon not reachable
      </span>
    ) : (
      <span className="inline-flex shrink-0 items-center gap-2 h-[30px] px-3 text-[12px] text-ink-2 whitespace-nowrap" data-testid="status-loading">
        <Dot color="var(--rule-strong)" />
        <span className="sr-only sm:not-sr-only">Connecting</span>
      </span>
    );
  }
  const agents = health.adapters.filter((a) => a.id !== 'replay');
  const ready = agents.filter((a) => a.capability.level === 'supported');
  // turned off in config, which one line says for all of them; on but unable to run, which each says why
  const disabled = agents.filter((a) => a.capability.level !== 'supported' && a.enabled === false);
  const broken = agents.filter((a) => a.capability.level !== 'supported' && a.enabled !== false);
  const models = modelRows(health.models ?? []);
  const readyModels = models.filter((m) => m.ready).length;
  const daemon = health.mode === 'replay' ? 'Replay daemon' : 'Daemon';
  // a live daemon with no agent that can run is the one state that needs attention here
  const tone = ready.length === 0 && health.mode === 'live' ? 'var(--sw-yellow)' : 'var(--sw-green)';

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        data-testid="status-button"
        className="inline-flex items-center gap-2 h-8 px-2 sm:px-3 rounded-[3px] border border-ink-3 text-[12px] text-ink-2 whitespace-nowrap hover:border-ink hover:text-ink"
      >
        <Dot color={tone} />
        <span className="hidden lg:inline">
          {daemon}, {plural(ready.length, 'agent')}, {plural(readyModels, 'model')}
        </span>
        <span className="lg:hidden sr-only sm:not-sr-only">Status</span>
        <svg aria-hidden="true" viewBox="0 0 12 12" className={cx('size-3 text-ink-2 transition-transform', open && 'rotate-180')}>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Daemon, agents and models"
          data-testid="status-panel"
          className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-32px)] max-h-[70vh] overflow-y-auto rounded-[4px] border border-rule-strong bg-ground p-3 shadow-[var(--shadow)]"
        >
          <Group title="Daemon">
            <Row dot="var(--sw-green)" name={daemon} detail={`version ${health.version}, started ${localTime(health.startedAt)}${health.repo ? `, in ${health.repo}` : ''}`} />
          </Group>
          <Group title={`Agents, ${ready.length} ready`}>
            {ready.map((a) => (
              <Row key={a.id} dot={markColor[agentOf(a.id).mark]} name={ADAPTER_NAMES[a.id] ?? a.id} detail={[a.version, a.gate === 'none' ? null : `Stint's gate is ${a.gate}`].filter(Boolean).join(', ')} />
            ))}
            {ready.length === 0 ? <li className="py-1 text-[12px] text-ink-3">No agent can take a run yet.</li> : null}
          </Group>
          {broken.length ? (
            <Group title="Agents that cannot run">
              {broken.map((a) => (
                <Row key={a.id} off dot="" name={ADAPTER_NAMES[a.id] ?? a.id} detail={a.reason ?? 'unavailable'} />
              ))}
            </Group>
          ) : null}
          {disabled.length ? (
            <Group title="Agents you can turn on">
              <li className="py-1 text-[12px] text-ink-2" data-testid="agents-off">
                {disabled.map((a) => ADAPTER_NAMES[a.id] ?? a.id).join(', ')}
                <span className="block text-[12px] text-ink-3">
                  Set <code className="font-mono">agents.&lt;id&gt;.enabled</code> to true in .stint/config.json, then restart stint up.
                </span>
              </li>
            </Group>
          ) : null}
          {models.length ? (
            <Group title={`Models, ${readyModels} ready`}>
              {models.map((m) => (
                <Row key={m.name} off={!m.ready} dot={markColor[m.mark]} name={m.name} detail={m.detail} />
              ))}
            </Group>
          ) : null}
          {health.localModels?.length ? (
            <Group title="On this machine, in no route yet">
              {health.localModels.map((m) => (
                <Row
                  key={`${m.host}/${m.model}`}
                  dot={markColor[agentOf('openai-compatible', m.host, m.model).mark]}
                  name={`${m.model}${m.parameters ? `, ${m.parameters}` : ''}`}
                  detail={`stint hand <task> stint-agent --model ${m.host}/${m.model}`}
                />
              ))}
            </Group>
          ) : null}
          {credits.length ? (
            <Group title="Credits left, from metered spend against the balance you set">
              {credits.map((c) => (
                <Row key={c.host} dot="var(--rule-strong)" name={hostName(c.host)} detail={`about $${c.left.toFixed(2)}`} />
              ))}
            </Group>
          ) : null}
          <Link to="/factory" onClick={() => setOpen(false)} className="mt-3 block text-[14px] text-ink underline underline-offset-2 hover:no-underline">
            Cost and models in the Standings
          </Link>
        </div>
      ) : null}
    </div>
  );
}
