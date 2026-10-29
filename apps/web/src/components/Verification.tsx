import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { DaemonError, type Verification, api, daemonMessage } from '../api';
import { localTime } from '../format';
import { useHold } from './Scrubber';
import { StackTrace } from './StackTrace';
import { VisualChecks } from './VisualChecks';
import { PlannedEmpty } from './Cards';
import { Button, Explain, StateMark, StatusChip, cx, tabKeys } from './ui';

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

/** The tamper guard line (R-029): unchanged, changed and allowed by its decision, or changed unexplained. */
export function tamperText(v: Verification): string | null {
  if (v.tamper === undefined) return null;
  if (v.tamper === null) return 'Unchanged';
  const files = v.tamper.files.join(', ');
  return v.tamper.allowedBy ? `Changed (${files}), allowed by decision ${v.tamper.allowedBy}` : `Changed, and no decision allows it: ${files}`;
}

/** Held-out scenarios (R-037): counts on the card; the names are listed under it, the source never leaves the daemon. */
export function scenariosText(v: Verification): string | null {
  if (!v.scenarios) return null;
  return `Hidden scenarios, which the agent never sees: ${v.scenarios.passed} passed, ${v.scenarios.failed} failed`;
}

/** The coverage delta (R-037), or why there is none; never shown when coverage is simply off. */
export function coverageText(v: Verification): string | null {
  if (v.coverage) {
    const pct = (n: number | null) => (n === null ? 'not given' : `${n}%`);
    return `Coverage ${pct(v.coverage.base)} on the base, ${pct(v.coverage.branch)} on the branch`;
  }
  return v.coverageReason ? `No coverage: ${v.coverageReason}` : null;
}

/** Each acceptance criterion with the tests whose names share its key words. A match by name, said as such. */
export function mapCriteria(criteria: string[], tests: TestLine[]): Array<{ text: string; tests: TestLine[] }> {
  return criteria.map((text) => {
    const want = words(text);
    const need = want.size <= 2 ? 1 : 2;
    return { text, tests: tests.filter((t) => [...words(t.name)].filter((w) => want.has(w)).length >= need) };
  });
}

export function VerificationTab({ taskId, acceptance, locked = [], live, onChanged, status = 'planned' }: { taskId: string; acceptance: string[]; locked?: string[]; live: boolean; onChanged: () => void; status?: string }) {
  const [runs, setRuns] = useState<Verification[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [outputNote, setOutputNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hold = useHold();
  const id = useId();

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

  // the files this task changed, so a frame in one of them can link to it in the diff
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!v || v.failed === 0) return;
    let live = true;
    api
      .diffFiles(taskId)
      .then((files) => live && setChangedFiles(files.map((f) => f.path)))
      .catch(() => live && setChangedFiles([]));
    return () => {
      live = false;
    };
  }, [taskId, v]);

  const tests = useMemo(() => (output ? testsFrom(output) : []), [output]);
  const criteria = useMemo(() => mapCriteria(acceptance, tests), [acceptance, tests]);
  // the output is gone or unreadable, so the criteria cannot be matched to tests
  const noOutput = !output && outputNote !== null;
  const failing = (v as (Verification & { failing?: string[] }) | null)?.failing ?? tests.filter((t) => !t.ok).map((t) => t.name);

  const rerun = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api
      .verify(taskId)
      .then((r) => {
        setPicked(r.run);
        load();
        onChanged();
      })
      .catch((e: unknown) => setError(daemonMessage(e)))
      .finally(() => setBusy(false));
  };

  if (runs === null) return <p className="text-ink-3">Reading the test runs.</p>;
  if (!v)
    return (
      <PlannedEmpty testId="empty-verification" status={status} settled="Stint recorded no test run on this task.">
        Verification runs here when the run ends.
      </PlannedEmpty>
    );

  return (
    <div className="flex flex-col gap-4 max-w-[80ch]" data-testid="verification-tab">
      <Explain word="verify" />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Test runs" onKeyDown={tabKeys}>
          {runs.map((r) => (
            <button
              key={r.run}
              id={`${id}-${r.run}`}
              type="button"
              role="tab"
              aria-selected={r.run === v.run}
              aria-controls={`${id}-panel`}
              tabIndex={r.run === v.run ? 0 : -1}
              onClick={() => setPicked(r.run)}
              data-testid={`verification-run-${r.run}`}
              className={cx('stint-button min-h-8 h-8 px-3 font-normal', r.run !== v.run && 'border-rule text-ink-2 hover:text-ink')}
            >
              <span className="font-mono">{r.run}</span>
              <span className={cx('inline-flex items-center gap-1.5 tabular', r.status === 'green' ? 'text-green' : 'text-red')}>
                <StateMark shape={r.status === 'green' ? 'verified' : 'failed'} />
                {r.passed} of {r.passed + r.failed} passed
              </span>
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-2">
          {live ? <span className="text-small text-ink-3">A run is going; Stint tests it when it ends.</span> : null}
          <Button onClick={rerun} aria-disabled={busy || live} aria-busy={busy} data-testid="rerun" {...hold}>
            {busy ? 'Running the tests' : 'Re-run the tests'}
          </Button>
        </span>
      </div>
      {error ? (
        <p className="text-small text-red" role="alert">
          {error}
        </p>
      ) : null}

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${v.run}`} className="flex flex-col gap-4 min-w-0">
        <article data-testid="verification-card" className={cx('rounded-[5px] border bg-panel p-4', v.status === 'green' ? 'border-green/50' : 'border-red/50')}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-body font-semibold tabular" data-testid="verification-summary">
              {v.passed} passed{v.tamper === null ? ', tests unchanged' : ''}
              {v.failed ? `, ${v.failed} failed` : ''}, run by Stint
            </p>
            <StatusChip status={v.status} label={v.status === 'green' ? 'verified' : v.status === 'red' ? 'failed' : undefined} />
          </div>
          {tamperText(v) || scenariosText(v) || coverageText(v) ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-3 text-small">
              {tamperText(v) ? (
                <>
                  <dt className="text-ink-2">Locked tests</dt>
                  <dd data-testid="tamper-line" className={cx(v.tamper && !v.tamper.allowedBy && 'text-red')}>
                    {tamperText(v)}
                    {v.tamper === null && locked.length ? `: ${locked.join(', ')}` : ''}
                  </dd>
                </>
              ) : null}
              {scenariosText(v) ? (
                <>
                  <dt className="text-ink-2">Scenarios</dt>
                  <dd data-testid="scenarios-line" className={cx((v.scenarios?.failed ?? 0) > 0 && 'text-red')}>
                    {scenariosText(v)}
                  </dd>
                </>
              ) : null}
              {coverageText(v) ? (
                <>
                  <dt className="text-ink-2">Coverage</dt>
                  <dd data-testid="coverage-line" className="tabular">
                    {coverageText(v)}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : null}
          {v.checks?.length ? (
            <div className="mt-3">
              <p className="text-small text-ink-2 mb-1">Checks</p>
              <ul className="flex flex-col gap-1" data-testid="verify-checks">
                {v.checks.map((check) => (
                  <li key={check.name} data-testid={`check-${check.name}`} className="flex flex-wrap items-center gap-2 text-small">
                    <StatusChip status={check.status} label={check.status === 'green' ? 'passed' : check.status === 'red' ? 'failed' : undefined} />
                    <span className="font-mono">{check.name}</span>
                    <span className="text-ink-3">{check.kind}</span>
                    <span className="tabular text-ink-2">
                      {check.passed !== undefined ? `${check.passed} passed, ${check.failed ?? 0} failed, ` : ''}
                      {(check.durationMs / 1000).toFixed(1)} s, exit code {check.exitCode}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {failing.length ? (
            <div className="mt-3">
              <p className="text-small text-ink-2 mb-1">Failing</p>
              <ul className="flex flex-col gap-1" data-testid="failing-tests">
                {failing.map((name) => (
                  <li key={name} className="flex items-baseline gap-1.5 font-mono text-small text-red">
                    <StateMark shape="failed" className="translate-y-px" />
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <details className="mt-3 text-small">
            <summary className="w-fit min-h-6 cursor-pointer font-medium text-ink-2 hover:text-ink">How the tests ran</summary>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-2">
              <dt className="text-ink-2">Command</dt>
              <dd className="font-mono break-all">{v.command}</dd>
              <dt className="text-ink-2">Exit code</dt>
              <dd className="tabular">{v.exitCode}</dd>
              <dt className="text-ink-2">Duration</dt>
              <dd className="tabular">{(v.durationMs / 1000).toFixed(1)} s</dd>
              <dt className="text-ink-2">Run</dt>
              <dd>
                {v.run}, at {localTime(v.at)}
              </dd>
              {v.commit ? (
                <>
                  <dt className="text-ink-2">Commit</dt>
                  <dd className="font-mono">
                    {v.commit.slice(0, 12)} <span className="font-sans text-ink-3">Approving merges only this commit.</span>
                  </dd>
                </>
              ) : null}
            </dl>
            {v.scenarios?.names.length ? (
              <>
                <p className="text-ink-2 mt-2 mb-1">Scenario names</p>
                <ul className="flex flex-col gap-1" data-testid="scenario-names">
                  {v.scenarios.names.map((name) => (
                    <li key={name} className="font-mono text-ink-2">
                      {name}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </details>
        </article>

        {output && v.failed > 0 ? <StackTrace taskId={taskId} output={output} changedFiles={changedFiles} /> : null}
        <VisualChecks taskId={taskId} run={v.run} at={v.at} />

        <section aria-labelledby={`${id}-criteria`} data-testid="acceptance">
          <h3 id={`${id}-criteria`} className="text-body font-semibold">
            What the task must do
          </h3>
          <p className="text-small text-ink-2 mb-1">
            {noOutput ? `Not matched to tests, since the test output is not available: ${outputNote?.replace(/\.$/, '')}.` : 'Each point is matched to tests by the words in their names; a point with no match is left to the review.'}
          </p>
          <ul className="flex flex-col">
            {criteria.map((c) => {
              const bad = c.tests.some((t) => !t.ok);
              return (
                <li key={c.text} className="border-t border-rule py-2 text-small">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-ink">{c.text}</span>
                    {!output ? null : c.tests.length === 0 ? (
                      <StatusChip label="no test by name" tone="neutral" />
                    ) : (
                      <StatusChip label={bad ? 'failing' : `checked by ${c.tests.length} test${c.tests.length === 1 ? '' : 's'}`} tone={bad ? 'bad' : 'good'} />
                    )}
                  </div>
                  {c.tests.length ? (
                    <ul className="mt-1">
                      {c.tests.slice(0, 4).map((t) => (
                        <li key={t.name} className={cx('flex items-baseline gap-1.5 font-mono text-small', t.ok ? 'text-ink-2' : 'text-red')}>
                          <StateMark shape={t.ok ? 'verified' : 'failed'} className="translate-y-px" />
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

        {output ? (
          <details className="border-t border-rule pt-3">
            <summary className="w-fit min-h-6 cursor-pointer font-semibold hover:underline underline-offset-4" data-testid="toggle-output">
              Test output
            </summary>
            <pre tabIndex={0} className="mt-2 max-h-[420px] overflow-auto rounded-[5px] border border-rule bg-term p-3 font-mono text-small text-term-ink whitespace-pre-wrap" data-testid="verification-output">
              {output.replace(/\x1b\[[0-9;]*m/g, '')}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
