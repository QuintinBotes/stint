import { useState } from 'react';
import { modelName } from '../agents';
import type { StintEvent } from '@stint-dev/core';
import { DaemonError, type QuizResult, api } from '../api';
import { money } from '../format';
import { useHold } from './Scrubber';
import { Button, StateMark, StatusChip } from './ui';

/** Is the packet enough? One model writes facts from the full record, another answers them from the packet alone. */
export function QuizPanel({ taskId, name, events }: { taskId: string; name: string; events: StintEvent[] }) {
  const recorded = events.filter((e) => e.type === 'handoff.quizzed' && e.payload.name === name).at(-1)?.payload as QuizResult | undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hold = useHold();
  const run = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api
      .quiz(taskId, name)
      .catch((e: unknown) => setError(e instanceof DaemonError ? e.error.message : String(e)))
      .finally(() => setBusy(false));
  };
  const misses = recorded ? [...recorded.blockingMisses, ...recorded.advisoryMisses] : [];
  return (
    <details className="max-w-[760px] pt-3 border-t border-rule" data-testid="quiz">
      <summary className="w-fit min-h-6 cursor-pointer font-semibold hover:underline underline-offset-4">
        Is this packet enough?
        {recorded ? <span className="font-normal text-ink-2 tabular">{` ${recorded.correct} of ${recorded.total} facts recovered`}</span> : null}
      </summary>
      <div className="mt-2 flex flex-col gap-2 text-body">
        <p className="text-small text-ink-2 max-w-[60ch]">
          Muse Wonder writes true or false statements from everything the run did. Muse Glimmer, on this machine, answers them from the packet alone. A wrong answer is something the next agent would not know.
        </p>
        {recorded ? (
          <>
            <p className="flex flex-wrap items-center gap-2" data-testid="quiz-score">
              <span className="text-section font-semibold tabular">
                {recorded.correct} of {recorded.total} facts
              </span>
              <span className="text-ink-2">recovered from the packet alone</span>
              {recorded.blockingMisses.length ? <StatusChip label={`${recorded.blockingMisses.length} blocking missed`} tone="bad" /> : <StatusChip label="nothing blocking missed" tone="neutral" />}
            </p>
            {misses.length ? (
              <ul className="flex flex-col gap-1">
                {misses.map((m) => (
                  <li key={m.id} className="text-small">
                    <span className={m.blocking ? 'inline-flex items-center gap-1 text-red font-medium' : 'text-ink-2'}>
                      {m.blocking ? <StateMark shape="failed" /> : null}
                      {m.blocking ? 'Blocking' : 'Missed'}
                    </span> <span className="text-ink">{m.text}</span>{' '}
                    <span className="text-ink-3">
                      (it is {String(m.truth)}; the packet gave: {m.answer})
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-small text-ink-3">
              Statements by {modelName(recorded.writer.model)} ({money(recorded.writer.cost)}), answered by {modelName(recorded.answerer.model)} ({recorded.answerer.host === 'ollama' ? 'on this machine, free' : money(recorded.answerer.cost)}).
            </p>
          </>
        ) : null}
        <Button className="self-start h-8 px-2.5 text-small" onClick={run} aria-disabled={busy} aria-busy={busy} {...hold}>
          {busy ? 'Checking' : recorded ? 'Check again' : 'Check this packet'}
        </Button>
        {error ? (
          <p className="text-small text-red" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
