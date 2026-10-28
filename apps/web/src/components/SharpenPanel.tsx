import { type SharpenState, type StintEvent, type TaskProof, sharpenState } from '@stint-dev/core';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { type TaskBundle, api, daemonMessage } from '../api';
import { useHealth } from '../hooks';
import { Button, Explain, StatusChip, cx } from './ui';

type Question = SharpenState['questions'][number];
type Answer = { option?: string; text?: string };

const LETTERS = 'ABCD';
const KINDS: Array<{ kind: TaskProof['kind']; name: string; hint: string }> = [
  { kind: 'test', name: 'A test', hint: 'The test name, or part of it' },
  { kind: 'scenario', name: 'A scenario', hint: 'The held-out scenario name' },
  { kind: 'check', name: 'A check', hint: 'The check name, such as typecheck' },
  { kind: 'human', name: 'You check it', hint: 'What you look at before you approve' },
];
const field = 'h-9 rounded-[5px] border border-field bg-ground px-3 text-ink placeholder:text-ink-3';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Sharpen, above the tabs (R-064): before any run, a button that starts a round; then one card per open question,
 * the answered ones as one line with their decision, what Stint assumed, and the proof of each criterion.
 */
export function SharpenPanel({ bundle, events }: { bundle: TaskBundle; events: StintEvent[] }) {
  const task = bundle.task;
  const st = useMemo(() => sharpenState(events, task), [events, task]);
  const { data: health } = useHealth();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const asked = useRef(false);

  const act = useCallback((doing: string, p: Promise<unknown>) => {
    setBusy(doing);
    setError(null);
    return p
      .then(() => true)
      .catch((e: unknown) => {
        setError(daemonMessage(e));
        return false;
      })
      .finally(() => setBusy(null));
  }, []);
  const start = useCallback(() => void act('Stint is reading the task, its files and what it remembers. The questions appear here.', api.sharpen(task.id)), [act, task.id]);

  // "Sharpen it first" in the New task dialog opens the task with ?sharpen=1: the round starts once, and the flag goes
  useEffect(() => {
    if (params.get('sharpen') !== '1' || asked.current) return;
    asked.current = true;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('sharpen');
        return next;
      },
      { replace: true },
    );
    start();
  }, [params, setParams, start]);

  // an answered card collapses to its line; the focus follows it there rather than falling to the page
  useEffect(() => {
    if (!focusOn) return;
    const line = document.getElementById(`sharpen-line-${focusOn}`);
    if (!line) return;
    line.focus();
    setFocusOn(null);
  }, [st, focusOn]);

  const answer = (ref: { question: string } | { assumption: string }, a: Answer) =>
    void act('Recording your answer as a decision.', api.answerSharpen(task.id, { ...ref, ...a })).then((ok) => ok && setFocusOn('question' in ref ? ref.question : ref.assumption));

  const status = (
    <>
      {/* always in the page so a screen reader hears it change; out of the layout while there is nothing to say */}
      <p role="status" className={busy ? 'text-small text-ink-2' : 'sr-only'}>
        {busy}
      </p>
      {error ? (
        <p role="alert" className="text-small text-red">
          {error}
        </p>
      ) : null}
    </>
  );

  if (st.round === 0) {
    // a replay calls no model, so it offers no round: the recorded story stays as it was
    if (bundle.runs.length > 0 || !health || health.mode === 'replay') return null;
    return (
      <section className="flex flex-col gap-2" data-testid="sharpen-panel" aria-label="Sharpen">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button onClick={start} disabled={!!busy} data-testid="sharpen-start">
            Sharpen this task
          </Button>
          <Explain word="sharpen" />
        </div>
        {status}
      </section>
    );
  }

  const open = st.questions.filter((q) => !q.answered);
  const answered = st.questions.filter((q) => q.answered);
  const rest = open.filter((q) => !q.material).length;
  return (
    <section className="flex flex-col gap-3" data-testid="sharpen-panel" aria-labelledby="sharpen-title">
      <div>
        <h2 id="sharpen-title" className="text-section">
          Sharpen
        </h2>
        <p className="mt-1 text-small text-ink-2">
          Round {st.round}: {plural(open.length, 'question')} open
          {st.openMaterial.length ? `, ${plural(st.openMaterial.length, 'needs', 'need')} your answer` : ''}. Each answer is recorded as a decision the plan and every agent keep.
        </p>
      </div>

      {answered.length ? (
        <ul className="flex flex-col" aria-label="Answered">
          {answered.map((q) => (
            <li key={q.id} id={`sharpen-line-${q.id}`} tabIndex={-1} data-testid={`sharpen-answered-${q.id}`} className="flex flex-wrap items-baseline gap-x-2 py-1.5 border-b border-rule text-small outline-offset-2">
              <span className="font-mono text-ink-2">{q.id}</span>
              <span className="min-w-0">{q.text}</span>
              <span>
                <span className="font-medium">{[q.answered?.option, q.answered?.text].filter(Boolean).join(', ')}</span>
                <span className="text-ink-2">, recorded as </span>
                <span className="font-mono" data-testid="sharpen-decision">
                  {q.answered?.decision}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {open.map((q) => (
        <QuestionCard key={q.id} q={q} busy={!!busy} onAnswer={(a) => answer({ question: q.id }, a)} />
      ))}
      {rest ? (
        <Button className="self-start" disabled={!!busy} data-testid="sharpen-recommended" onClick={() => void act('Taking the recommendations.', api.takeRecommendations(task.id))}>
          Use the recommendations for the rest
        </Button>
      ) : null}

      {st.assumed.length ? <Assumed st={st} busy={!!busy} onChange={(id, text) => answer({ assumption: id }, { text })} /> : null}

      <Proofs key={JSON.stringify([st.proofs.accepted, st.proofs.suggested])} st={st} acceptance={task.acceptance} busy={!!busy} onUse={(proofs) => void act('Recording the proofs.', api.setProofs(task.id, proofs))} />

      {st.ready ? (
        <p data-testid="sharpen-ready" className="font-medium text-ink">
          Ready: every criterion has a proof and nothing waits on you.
        </p>
      ) : null}
      {status}
    </section>
  );
}

/** One open question: the options as a native radio group, the recommended one marked, and a field for an answer of your own. */
function QuestionCard({ q, busy, onAnswer }: { q: Question; busy: boolean; onAnswer: (a: Answer) => void }) {
  const [choice, setChoice] = useState(q.recommendation.option);
  const [other, setOther] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAnswer(other.trim() ? { text: other.trim() } : { option: choice });
  };
  const letter = LETTERS[q.options.findIndex((o) => o.label === q.safeDefault.option)];
  const safe = q.safeDefault.exists ? `Safe default: ${q.safeDefault.option ? `${letter}, ${q.safeDefault.option}` : 'yes'}.${q.safeDefault.why ? ` ${q.safeDefault.why}` : ''}` : 'No safe default: a wrong answer is costly to undo.';
  return (
    <form onSubmit={submit} data-testid={`sharpen-card-${q.id}`} className="flex flex-col gap-3 p-3 rounded-[5px] border border-rule-strong bg-panel">
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-small text-ink-2">{q.id}</span>
          <span className="text-body font-medium">{q.text}</span>
          {q.material ? <StatusChip label="Needs your answer" tone="warn" /> : null}
        </legend>
        <p className="text-small text-ink-2">What Stint found: {q.evidence}</p>
        {q.options.map((o, i) => (
          <label key={o.label} className={cx('grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 p-2.5 rounded-[5px] border cursor-pointer', choice === o.label ? 'border-ink bg-panel-2' : 'border-rule')}>
            <input type="radio" name={`sharpen-${q.id}`} value={o.label} checked={choice === o.label} onChange={() => setChoice(o.label)} className="mt-[3px]" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {LETTERS[i]}. {o.label}
                </span>
                {o.label === q.recommendation.option ? <StatusChip label="recommended" tone="recommend" /> : null}
              </span>
              <span className="text-small text-ink-2">{o.consequence}</span>
              {o.label === q.recommendation.option ? <span className="text-small text-ink-2">Why: {q.recommendation.why}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-small text-ink-2">
        {safe} {q.blocks.length ? `Blocks criteri${q.blocks.length === 1 ? 'on' : 'a'} ${q.blocks.join(', ')}.` : 'Blocks no criterion.'}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5 text-small font-medium">
          Something else
          <input value={other} onChange={(e) => setOther(e.target.value)} maxLength={1000} className={cx(field, 'font-normal text-body')} />
        </label>
        <Button type="submit" disabled={busy} data-testid={`sharpen-answer-${q.id}`}>
          Answer
        </Button>
      </div>
    </form>
  );
}

/** The reversible details Stint settled itself; Change opens the same answer form, with your own words. */
function Assumed({ st, busy, onChange }: { st: SharpenState; busy: boolean; onChange: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  return (
    <div data-testid="sharpen-assumed">
      <h3 className="font-semibold">Assumed</h3>
      <ul className="mt-1 flex flex-col">
        {st.assumed.map((a) => (
          <li key={a.id} id={`sharpen-line-${a.id}`} tabIndex={-1} className="flex flex-col gap-2 py-1.5 border-b border-rule text-small outline-offset-2">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-ink-2">{a.id}</span>
              <span className="min-w-0 flex-1">{a.changed ? <>{a.changed.text} <span className="text-ink-2">(was: {a.text})</span></> : a.text}</span>
              {a.changed ? <span className="font-mono text-ink-2">{a.changed.decision}</span> : null}
              <Button className="h-8 px-2.5 text-small" aria-expanded={editing === a.id} aria-label={`Change ${a.id}`} onClick={() => setEditing(editing === a.id ? null : a.id)}>
                Change
              </Button>
            </span>
            {!a.changed ? <span className="text-ink-2">Why: {a.why}</span> : null}
            {editing === a.id ? (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text.trim()) return;
                  onChange(a.id, text.trim());
                  setEditing(null);
                  setText('');
                }}
              >
                <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5 font-medium">
                  Something else
                  <input value={text} onChange={(e) => setText(e.target.value)} required maxLength={1000} className={cx(field, 'font-normal text-body')} />
                </label>
                <Button type="submit" disabled={busy}>
                  Answer
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One row per criterion, prefilled from the accepted proof or else the suggestion; "Use these proofs" accepts them. */
function Proofs({ st, acceptance, busy, onUse }: { st: SharpenState; acceptance: string[]; busy: boolean; onUse: (proofs: TaskProof[]) => void }) {
  const [rows, setRows] = useState(() =>
    acceptance.map((_, i) => {
      const p = st.proofs.accepted.find((x) => x.criterion === i + 1) ?? st.proofs.suggested.find((x) => x.criterion === i + 1);
      return { kind: p?.kind ?? ('test' as TaskProof['kind']), ref: p?.ref ?? '' };
    }),
  );
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((now) => now.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <form
      data-testid="sharpen-proofs"
      onSubmit={(e) => {
        e.preventDefault();
        onUse(rows.flatMap((r, i) => (r.ref.trim() ? [{ criterion: i + 1, kind: r.kind, ref: r.ref.trim().slice(0, 200) }] : [])));
      }}
    >
      <h3 className="font-semibold">Proofs</h3>
      <p className="text-small text-ink-2">How each criterion is shown to be met. A test proof must fail before the change and pass after it.</p>
      <ol className="mt-1 flex flex-col">
        {acceptance.map((text, i) => {
          const n = i + 1;
          const accepted = st.proofs.accepted.some((p) => p.criterion === n);
          const suggested = st.proofs.suggested.find((p) => p.criterion === n);
          const row = rows[i] as (typeof rows)[number];
          return (
            <li key={n} className="flex flex-col gap-1.5 py-2 border-b border-rule">
              <span>
                <span className="tabular text-ink-2">{n}.</span> {text}
              </span>
              <span className="flex flex-wrap gap-2">
                <select aria-label={`How criterion ${n} is proven`} value={row.kind} onChange={(e) => set(i, { kind: e.target.value as TaskProof['kind'] })} className={cx(field, 'px-2')}>
                  {KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.name}
                    </option>
                  ))}
                </select>
                <input aria-label={`What proves criterion ${n}`} value={row.ref} placeholder={KINDS.find((k) => k.kind === row.kind)?.hint} onChange={(e) => set(i, { ref: e.target.value })} maxLength={200} className={cx(field, 'min-w-0 flex-1 basis-56')} />
              </span>
              <span className="text-small text-ink-2">{accepted ? 'Accepted.' : suggested ? `Suggested: ${suggested.why}` : 'No proof yet.'}</span>
            </li>
          );
        })}
      </ol>
      <Button type="submit" className="mt-3" disabled={busy || rows.every((r) => !r.ref.trim())} data-testid="sharpen-use-proofs">
        Use these proofs
      </Button>
    </form>
  );
}
