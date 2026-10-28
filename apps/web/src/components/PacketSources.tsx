import type { StintEvent } from '@stint-dev/core';
import { useEffect, useState } from 'react';
import { api } from '../api';

type Meta = { fields: Record<string, { from: string; eventIds: string[] }>; reason: string; enriched: string[] };

const FROM: Record<string, string> = {
  events: 'the event log',
  diff: 'the git diff',
  plan: 'the plan',
  enrich: 'the leaving agent, asked before its session closed',
  digest: 'a model reading the diff',
};

/** Where each part of a packet came from, so nothing in it has to be taken on trust. */
export function PacketSources({ taskId, name, events, onSelect }: { taskId: string; name: string; events: StintEvent[]; onSelect: (seq: number) => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    let live = true;
    api
      .handoff(taskId, name)
      .then((r) => live && setMeta((r.meta as Meta | null) ?? null))
      .catch(() => live && setMeta(null));
    return () => {
      live = false;
    };
  }, [taskId, name]);
  if (!meta?.fields) return null;
  const seqOf = new Map(events.map((e) => [e.id, e.seq]));
  return (
    <details className="rounded-[5px] border border-rule bg-panel p-4" data-testid="packet-sources">
      <summary className="text-body font-semibold cursor-pointer">Where each part came from</summary>
      <table className="mt-3 w-full text-small">
        <tbody>
          {Object.entries(meta.fields).map(([field, f]) => (
            <tr key={field} className="border-t border-rule align-top">
              <td className="py-2 pr-3 font-mono text-ink whitespace-nowrap">{field}</td>
              <td className="py-2 pr-3 text-ink-2">{FROM[f.from] ?? f.from}</td>
              <td className="py-2 tabular">
                {f.eventIds.slice(0, 8).map((id) => {
                  const seq = seqOf.get(id);
                  return seq === undefined ? null : (
                    <button key={id} type="button" className="mr-2 text-ink hover:underline" onClick={() => onSelect(seq)}>
                      #{seq}
                    </button>
                  );
                })}
                {f.eventIds.length > 8 ? <span className="text-ink-3">and {f.eventIds.length - 8} more</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
