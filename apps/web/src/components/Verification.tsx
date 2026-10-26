import { useCallback, useEffect, useMemo, useState } from 'react';
import { DaemonError, type Verification, api } from '../api';
import { localTime } from '../format';
import { Button, EmptyState, StatusChip, cx } from './ui';

type TestLine = { name: string; ok: boolean };

/** The tests a run reported by name: bun's (pass)/(fail) lines and Vitest's ✓/× lines. */
export function testsFrom(output: string): TestLine[] {
  const text = output.replace(/\x1b\[[0-9;]*m/g, '');
  const out: TestLine[] = [];
  for (const line of text.split('\n')) {
    const bun = /^\s*\((pass|fail)\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/.exec(line);
    if (bun) out.push({ name: (bun[2] as string).trim(), ok: bun[1] === 'pass' });
    const vitest = /^\s*(✓|√|×|✗)\s+(.+?)(?:\s+\d+m?s)?\s*$/.exec(line);
    if (vitest) out.push({ name: (vitest[2] as string).trim(), ok: vitest[1] === '✓' || vitest[1] === '√' });
  }
  return out;
}

const STOP = new Set(['the', 'and', 'with', 'when', 'that', 'this', 'from', 'over', 'into', 'are', 'for', 'not', 'other', 'gets', 'stays']);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length >= 3 && !STOP.has(w)));

/** Each acceptance criterion with the tests whose names share its key words. A match by name, said as such. */
export function mapCriteria(criteria: string[], tests: TestLine[]): Array<{ text: string; tests: TestLine[] }> {
  return criteria.map((text) => {
    const want = words(text);
    const need = want.size <= 2 ? 1 : 2;
    return { text, tests: tests.filter((t) => [...words(t.name)].filter((w) => want.has(w)).length >= need) };
  });
}

export function VerificationTab({ taskId, acceptance, live, onChanged }: { taskId: string; acceptance: string[]; live: boolean; onChanged: () => void }) {
  const [runs, setRuns] = useState<Verification[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [outputNote, setOutputNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);

  const load = useCallback(() => {
    api
      .verifications(taskId)
      .then((list) => setRuns(list))
      .catch(() => setRuns([]));
  }, [taskId]);
  useEffect(load, [load]);

  const latest = runs?.at(-1) ?? null;
  const v = (picked ? runs?.find((r) => r.run === picked) : null) ?? latest;

  useEffect(() => {
    if (!v) return;
    let live = true;
    setOutput(null);
    setOutputNote(null);
    api
      .verificationOutput(taskId, v.run)
      .then((text) => live && setOutput(text))
      .catch((e: unknown) => live && setOutputNote(e instanceof DaemonError ? e.error.message : 'The output could not be read.'));
    return () => {
      live = false;
    };
  }, [taskId, v]);

  const tests = useMemo(() => (output ? testsFrom(output) : []), [output]);
  const criteria = useMemo(() => mapCriteria(acceptance, tests), [acceptance, tests]);
  const failing = (v as (Verification & { failing?: string[] }) | null)?.failing ?? tests.filter((t) => !t.ok).map((t) => t.name);

  const rerun = () => {
    setBusy(true);
    setError(null);
    api
      .verify(taskId)
      .then((r) => {
        setPicked(r.run);
        load();
        onChanged();
      })
      .catch((e: unknown) => setError(e instanceof DaemonError ? `${e.error.message}${e.error.hint ? `: ${String(e.error.hint)}` : ''}` : String(e)))
      .finally(() => setBusy(false));
  };

  if (runs === null) return <p className="text-faint">Reading the verifications.</p>;
  if (!v) return <EmptyState testId="empty-verification">Verification runs here when the run ends.</EmptyState>;

  return (
    <div className="flex flex-col gap-4 max-w-[80ch]" data-testid="verification-tab">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Verifications by run">
        {runs.map((r) => (
          <button
            key={r.run}
            type="button"
            role="tab"
            aria-selected={r.run === v.run}
            onClick={() => setPicked(r.run)}
            data-testid={`verification-run-${r.run}`}
            className={cx('inline-flex items-center gap-2 h-8 px-3 rounded-md border text-[12.5px]', r.run === v.run ? 'border-accent text-ink' : 'border-line text-muted hover:text-ink')}
          >
            <span className="font-mono">{r.run}</span>
            <span className={cx('tabular', r.status === 'green' ? 'text-good' : 'text-bad')}>
              {r.passed}/{r.passed + r.failed}
            </span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {live ? <span className="text-[12px] text-faint">A run is live; the daemon verifies when it ends.</span> : null}
          <Button onClick={rerun} disabled={busy || live} data-testid="rerun">
            {busy ? 'Running the tests' : 'Re-run the tests'}
          </Button>
        </span>
      </div>
      {error ? (
        <p className="text-[12.5px] text-bad" role="alert">
          {error}
        </p>
      ) : null}

      <article data-testid="verification-card" className={cx('rounded-lg border p-4', v.status === 'green' ? 'border-good/50' : 'border-bad/50')}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-semibold tabular" data-testid="verification-summary">
            {v.passed} passed, {v.failed} failed, run by the daemon
          </p>
          <StatusChip status={v.status} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-3 text-[12.5px]">
          <dt className="text-muted">Command</dt>
          <dd className="font-mono">{v.command}</dd>
          <dt className="text-muted">Exit code</dt>
          <dd className="tabular">{v.exitCode}</dd>
          <dt className="text-muted">Duration</dt>
          <dd className="tabular">{(v.durationMs / 1000).toFixed(1)} s</dd>
          <dt className="text-muted">Run</dt>
          <dd>
            {v.run}, at {localTime(v.at)}
          </dd>
          {(v as Verification & { commit?: string }).commit ? (
            <>
              <dt className="text-muted">Commit</dt>
              <dd className="font-mono" title="Approve merges only this commit">
                {(v as Verification & { commit?: string }).commit?.slice(0, 12)}
              </dd>
            </>
          ) : null}
        </dl>
        {failing.length ? (
          <div className="mt-3">
            <p className="text-[12px] text-muted mb-1">Failing</p>
            <ul className="flex flex-col gap-1" data-testid="failing-tests">
              {failing.map((name) => (
                <li key={name} className="font-mono text-[12px] text-bad">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>

      <section aria-label="Acceptance criteria" data-testid="acceptance">
        <h3 className="text-[13px] font-semibold mb-1">Acceptance criteria</h3>
        <p className="text-[12px] text-faint mb-2">Each criterion is matched to tests by the words in their names; a criterion with no match is for the review to check.</p>
        <ul className="flex flex-col gap-2">
          {criteria.map((c) => {
            const bad = c.tests.some((t) => !t.ok);
            return (
              <li key={c.text} className="rounded-md border border-line bg-raised px-3 py-2 text-[12.5px]">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-ink">{c.text}</span>
                  {c.tests.length === 0 ? (
                    <StatusChip label={output ? 'no test by name' : 'output not kept'} tone="neutral" />
                  ) : (
                    <StatusChip label={bad ? 'failing' : `checked by ${c.tests.length} test${c.tests.length === 1 ? '' : 's'}`} tone={bad ? 'bad' : 'good'} />
                  )}
                </div>
                {c.tests.length ? (
                  <ul className="mt-1">
                    {c.tests.slice(0, 4).map((t) => (
                      <li key={t.name} className={cx('font-mono text-[11.5px]', t.ok ? 'text-muted' : 'text-bad')}>
                        {t.ok ? 'pass' : 'fail'} {t.name}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Test output">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-semibold">Output</h3>
          {output ? (
            <Button className="h-7" onClick={() => setShowOutput((s) => !s)} aria-expanded={showOutput} data-testid="toggle-output">
              {showOutput ? 'Hide the output' : 'Show the output'}
            </Button>
          ) : null}
        </div>
        {outputNote ? <p className="text-[12px] text-faint mt-1">{outputNote}</p> : null}
        {output && showOutput ? (
          <pre className="mt-2 max-h-[420px] overflow-auto rounded-md border border-line bg-term p-3 font-mono text-[11.5px] leading-[16px] text-term-ink whitespace-pre-wrap" data-testid="verification-output">
            {output.replace(/\x1b\[[0-9;]*m/g, '')}
          </pre>
        ) : null}
      </section>
    </div>
  );
}
