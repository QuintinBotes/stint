import { useState } from 'react';
import { modelName } from '../agents';
import type { StintEvent } from '@stint-dev/core';
import { DaemonError, type QuizResult, api } from '../api';
import { money } from '../format';
import { Button, StatusChip } from './ui';

/** Is the packet enough? One model writes facts from the full record, another answers them from the packet alone. */
export function QuizPanel({ taskId, name, events }: { taskId: string; name: string; events: StintEvent[] }) {
  const recorded = events.filter((e) => e.type === 'handoff.quizzed' && e.payload.name === name).at(-1)?.payload as QuizResult | undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setError(null);
    api
      .quiz(taskId, name)
      .catch((e: unknown) => setError(e instanceof DaemonError ? e.error.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="rounded-lg border border-rule bg-panel p-4" data-testid="quiz">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">Is this packet enough?</h3>
        <Button className="h-7" onClick={run} disabled={busy}>
          {busy ? 'Checking' : recorded ? 'Check again' : 'Check this packet'}
        </Button>
      </div>
      {!recorded ? (
        <p className="text-[12px] text-ink-2 mt-2 max-w-[64ch]">
          Muse Wonder writes true and false statements from everything the run did; Muse Glimmer, on this machine, answers them from the packet alone and must quote it. A miss is something the next agent would not know.
        </p>
      ) : (
        <div className="mt-3 text-[14px]">
          <p className="flex items-center gap-2" data-testid="quiz-score">
            <span className="text-[19px] font-semibold tabular">
              {recorded.correct}/{recorded.total}
            </span>
            <span className="text-ink-2">facts recovered from the packet alone</span>
            {recorded.blockingMisses.length ? <StatusChip label={`${recorded.blockingMisses.length} blocking`} tone="warn" /> : <StatusChip label="nothing blocking missed" tone="good" />}
          </p>
          {[...recorded.blockingMisses, ...recorded.advisoryMisses].length ? (
            <ul className="mt-2 flex flex-col gap-1">
              {[...recorded.blockingMisses, ...recorded.advisoryMisses].map((m) => (
                <li key={m.id} className="text-[12px]">
                  <span className={m.blocking ? 'text-yellow font-medium' : 'text-ink-2'}>{m.blocking ? 'Blocking' : 'Missed'}</span>{' '}
                  <span className="text-ink">{m.text}</span> <span className="text-ink-3">(it is {String(m.truth)}; the packet gave: {m.answer})</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[12px] text-ink-3 mt-2">
            Statements by {modelName(recorded.writer.model)} ({money(recorded.writer.cost)}), answered by {modelName(recorded.answerer.model)} ({recorded.answerer.host === 'ollama' ? 'on this machine, free' : money(recorded.answerer.cost)}).
          </p>
        </div>
      )}
      {error ? <p className="text-[12px] text-red mt-2">{error}</p> : null}
    </section>
  );
}
