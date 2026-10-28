import type { StintEvent } from '@stint-dev/core';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { rev } from './ui';

type Meta = { fields: Record<string, { from: string; eventIds: string[] }>; reason: string; enriched: string[] };

const FROM: Record<string, string> = {
  events: 'the event log',
  diff: 'the code change',
  plan: 'the plan',
  enrich: 'the leaving agent, asked before its session closed',
  digest: 'a model reading the code change',
};

/** The packet's parts by the names the card gives them; a part the card does not name keeps its own. */
const PART: Record<string, string> = {
  summary: 'Where it got to',
  done: 'Done',
  open: 'Left to do',
  leftOut: 'Left out',
  risks: 'Risks',
  askOfNext: 'Ask of the next agent',
  decisions: 'Decisions',
  changedFiles: 'Files changed',
  verification: 'Tests',
  cost: 'Cost so far',
  refusals: 'Refused actions',
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
    <details className="max-w-[760px] pt-3 border-t border-rule" data-testid="packet-sources">
      <summary className="w-fit min-h-6 cursor-pointer font-semibold hover:underline underline-offset-4">Where each part of this packet came from</summary>
      <table className={`${rev.table} mt-3`}>
        <thead>
          <tr>
            <th scope="col" className={rev.th}>
              Part
            </th>
            <th scope="col" className={rev.th}>
              Came from
            </th>
            <th scope="col" className={rev.th}>
              Events on the run rail
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(meta.fields).map(([field, f]) => (
            <tr key={field}>
              <td className={`${rev.td} whitespace-nowrap`}>{PART[field] ?? field}</td>
              <td className={`${rev.td} text-ink-2`}>{FROM[f.from] ?? f.from}</td>
              <td className={`${rev.td} tabular`}>
                <span className="flex flex-wrap gap-1">
                  {f.eventIds.slice(0, 8).map((id) => {
                    const seq = seqOf.get(id);
                    return seq === undefined ? null : (
                      <button key={id} type="button" aria-label={`Show event ${seq} on the run rail`} className="inline-flex items-center justify-center min-h-6 min-w-6 px-1 rounded-[3px] text-ink underline underline-offset-2 decoration-ink-3 hover:bg-panel" onClick={() => onSelect(seq)}>
                        #{seq}
                      </button>
                    );
                  })}
                  {f.eventIds.length > 8 ? <span className="self-center text-ink-3">and {f.eventIds.length - 8} more</span> : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
