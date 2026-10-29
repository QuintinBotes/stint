import { type Draft, type DraftAnswer, type DraftKind, type DraftProof, type DraftScenario, mergeAnswers } from '@stint-dev/core';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { Dialog, Field, useDraft } from './Shell';
import { Button, StatusChip, cx } from './ui';

/** Where the builder is: the person's words, a pasted Spec Kit spec, the questions, then the draft to edit and create. */
type Step = 'words' | 'spec' | 'questions' | 'draft';
type Doing = 'draft' | 'import' | 'refine' | 'create' | 'export';
type Question = Draft['questions'][number];

const LETTERS = 'ABCD';
const PARTS = [
  ['given', 'Given'],
  ['when', 'When'],
  ['then', 'Then'],
] as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fileField = 'text-small text-ink-2 file:mr-3 file:h-8 file:px-3 file:rounded-[5px] file:border file:border-solid file:border-rule-strong file:bg-transparent file:text-body file:font-semibold file:text-ink hover:file:border-ink-2';

// a list field keeps its blank lines while it is typed in, so Enter starts a new line; tidy drops them before a send
const asLines = (v: string) => v.split('\n').map((s) => s.slice(0, 300));
const sc = (i: number) => `SC-${String(i + 1).padStart(3, '0')}`;
// the page and what should be seen there share the proof's 200 characters, joined by " :: "
const PAGE_MAX = 60;
const SEEN_MAX = 136;

/** The draft as the daemon takes it: text trimmed, blank lines gone, the success criteria numbered again. */
function tidy(d: Draft): Draft {
  const keep = (xs: string[]) => xs.map((s) => s.trim()).filter(Boolean);
  return {
    ...d,
    title: d.title.trim(),
    summary: d.summary.trim(),
    stories: d.stories.map((s) => ({ ...s, title: s.title.trim(), scenarios: s.scenarios.map((x) => ({ ...x, given: x.given.trim(), when: x.when.trim(), then: x.then.trim(), ...(x.proof?.kind === 'visual' && x.proof.ref ? { proof: { kind: 'visual' as const, ref: x.proof.ref.trim() } } : {}) })) })),
    success: keep(d.success.map((s) => s.text)).map((text, i) => ({ id: sc(i), text })),
    nonGoals: keep(d.nonGoals),
    assumptions: keep(d.assumptions),
  };
}

/** The answers "Use the recommended answers" gives: the recommendation for each open question that is not material. */
const recommended = (d: Draft): DraftAnswer[] => d.questions.filter((q) => !q.material && !d.answers.some((a) => a.question === q.id)).map((q) => ({ question: q.id, choice: q.recommendation.option }));

/**
 * The spec builder (R-066), "What do you want done?": a sentence becomes a drafted spec in GitHub Spec Kit's shape, or
 * a Spec Kit spec.md is opened as one; the questions whose answers change what gets built come first, then the draft to
 * edit, then a task or a goal. The daemon holds nothing until create, so the draft lives here and a failed call keeps it.
 * Mount it per use, so each opening starts clean. `kind` is the kind asked for (New goal); `onWrite` opens the plain form.
 */
export function SpecBuilder({ kind, replay, onClose, onWrite }: { kind?: DraftKind; replay: boolean; onClose: () => void; onWrite: () => void }) {
  const navigate = useNavigate();
  const id = useId();
  const call = useDraft(true);
  const [doing, setDoing] = useState<Doing | null>(null);
  const [step, setStep] = useState<Step>('words');
  const [words, setWords] = useState('');
  const [spec, setSpec] = useState('');
  const [tasks, setTasks] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refined, setRefined] = useState(false);
  // each step starts at its top with focus on its heading or text box, since the button that led there may be gone; an
  // effect, so the dialog has already noted the opener and gives focus back there when it closes
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.closest('.stint-dialog-body')?.scrollTo({ top: 0 });
    top.current?.querySelector<HTMLElement>('h3, textarea')?.focus();
  }, [step]);
  const edit = (fn: (d: Draft) => Draft) => setDraft((now) => (now ? fn(now) : now));
  const send = <T,>(what: Doing, p: () => Promise<T>, done: (v: T) => void, refused: string) => {
    if (call.pending) return;
    setDoing(what);
    call.send(p, done, refused);
  };
  const busy = (what: Doing) => call.pending && doing === what;
  const opened = (d: Draft) => {
    setDraft(d);
    setStep(d.questions.length ? 'questions' : 'draft');
  };
  const go = (to: Step) => {
    call.setError(null);
    setStep(to);
  };
  // one more round at most: its new questions are asked, or with none the draft is next
  const afterRefine = (next: Draft) => {
    setRefined(true);
    setDraft(next);
    setStep(next.questions.length > (draft?.questions.length ?? 0) ? 'questions' : 'draft');
  };

  const body =
    step === 'words' ? (
      <form
        id={`${id}-words`}
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!replay) send('draft', () => api.draft(words.trim(), kind), opened, 'Stint did not draft it');
        }}
      >
        <Field id={`${id}-input`} label="In a sentence or two" hint={`Stint drafts a spec from it, asks only the questions whose answers change what gets built, and shows you the draft before any ${kind === 'goal' ? 'goal' : 'task'} is made.`}>
          <textarea
            id={`${id}-input`}
            value={words}
            onChange={(e) => setWords(e.target.value)}
            required
            maxLength={2000}
            rows={4}
            placeholder={kind === 'goal' ? 'Operators can tell the service is up without reading its logs.' : 'Add a health endpoint that answers 200 with ok.'}
            aria-describedby={`${id}-input-hint`}
            className="stint-input"
          />
        </Field>
        {replay ? (
          <p id={`${id}-replay`} className="stint-field-help">
            A replay calls no model, so it cannot draft a spec: open a Spec Kit spec, or write it yourself.
          </p>
        ) : null}
        <div className="grid gap-2">
          <div className="stint-actions">
            <Button onClick={() => go('spec')}>
              Open a Spec Kit spec
            </Button>
            <Button onClick={onWrite} data-testid="builder-write">
              Write it yourself
            </Button>
          </div>
          <p className="stint-field-help">Open a Spec Kit spec reads a spec.md you already have, with no model call. Write it yourself opens the plain form, for when you know exactly what you want.</p>
        </div>
      </form>
    ) : step === 'spec' ? (
      <form
        id={`${id}-spec`}
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          send('import', () => api.importDraft(spec, tasks.trim() || undefined), opened, 'The spec was not opened');
        }}
      >
        <h3 tabIndex={-1} className="text-section">
          Open a Spec Kit spec
        </h3>
        <p className="stint-field-help -mt-3">Paste a spec.md written with GitHub Spec Kit, or choose the file. Stint reads it as it is. With its tasks.md, each phase becomes one task of the goal.</p>
        <Markdown id={`${id}-spec-md`} label="spec.md" value={spec} onChange={setSpec} required />
        <Markdown id={`${id}-tasks-md`} label="tasks.md, optional" file="tasks.md" value={tasks} onChange={setTasks} />
      </form>
    ) : step === 'questions' && draft ? (
      <Questions draft={draft} refined={refined} onAnswer={(a) => edit((d) => ({ ...d, answers: mergeAnswers(d.answers, [a]) }))} onRecommended={() => edit((d) => ({ ...d, answers: mergeAnswers(d.answers, recommended(d)) }))} />
    ) : draft ? (
      <DraftForm
        id={id}
        draft={draft}
        edit={edit}
        onSubmit={(e) => {
          e.preventDefault();
          send(
            'create',
            () => api.createFromDraft(tidy(draft)),
            (r) => {
              onClose();
              navigate(r.kind === 'goal' ? `/goals/${r.id}` : `/t/${r.id}`);
            },
            `The ${draft.kind} was not created`,
          );
        }}
      />
    ) : null;

  const back: Step | null = step === 'spec' ? 'words' : step === 'draft' && draft?.questions.length ? 'questions' : null;
  const primary = (label: string, working: string, what: Doing, form: string, off = false) => (
    <Button tone="primary" type="submit" form={form} aria-disabled={call.pending || off} aria-busy={busy(what)} aria-describedby={off ? `${id}-replay` : undefined}>
      {busy(what) ? working : label}
    </Button>
  );
  const footer = (dismiss: () => void) => (
    <>
      {call.error ? (
        <p role="alert" className="stint-field-error basis-full" data-testid="builder-error">
          {call.error}
        </p>
      ) : null}
      {back ? (
        <Button tone="ghost" className="mr-auto" aria-disabled={call.pending} onClick={() => go(back)}>
          Back
        </Button>
      ) : null}
      <Button onClick={dismiss}>Cancel</Button>
      {step === 'words' ? primary('Draft it', 'Drafting', 'draft', `${id}-words`, replay) : null}
      {step === 'spec' ? primary('Open the spec', 'Opening', 'import', `${id}-spec`) : null}
      {step === 'questions' && draft ? (
        <>
          {refined ? null : (
            <Button aria-disabled={call.pending} aria-busy={busy('refine')} onClick={() => send('refine', () => api.refineDraft(tidy(draft)), afterRefine, 'Stint did not refine it')}>
              {busy('refine') ? 'Refining' : 'Refine'}
            </Button>
          )}
          <Button tone="primary" aria-disabled={call.pending} onClick={() => go('draft')}>
            Continue
          </Button>
        </>
      ) : null}
      {step === 'draft' && draft ? (
        <>
          <Button aria-disabled={call.pending} aria-busy={busy('export')} onClick={() => send('export', () => api.exportDraft(tidy(draft)), save, 'The spec was not exported')}>
            {busy('export') ? 'Exporting' : 'Download spec.md'}
          </Button>
          {primary(draft.kind === 'goal' ? 'Create goal' : 'Create task', draft.kind === 'goal' ? 'Creating goal' : 'Creating task', 'create', `${id}-draft`)}
        </>
      ) : null}
    </>
  );

  return (
    <Dialog title="What do you want done?" open onClose={onClose} dirty={!!(words.trim() || spec.trim() || tasks.trim() || draft)} width={720} footer={footer}>
      <div ref={top} className="grid gap-5">
        {body}
      </div>
    </Dialog>
  );
}

/** The exported spec.md as a download the browser saves. */
function save(markdown: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
  a.download = 'spec.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href));
}

/** A Markdown file pasted or chosen: the text area holds it either way, so what was chosen can be read and changed. */
function Markdown({ id, label, file = label, value, onChange, required = false }: { id: string; label: string; file?: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <Field id={id} label={label}>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required} maxLength={200_000} rows={required ? 8 : 4} spellCheck={false} className="stint-input font-mono text-small" />
      <input type="file" accept=".md,text/markdown,text/plain" aria-label={`Choose ${file}`} onChange={(e) => void e.target.files?.[0]?.text().then(onChange)} className={fileField} />
    </Field>
  );
}

/** Step 2: each question with its options, the recommended one marked, answered with one click or in the person's own words. */
function Questions({ draft, refined, onAnswer, onRecommended }: { draft: Draft; refined: boolean; onAnswer: (a: DraftAnswer) => void; onRecommended: () => void }) {
  const answered = (q: Question) => draft.answers.some((a) => a.question === q.id);
  const rest = recommended(draft).length;
  const left = draft.questions.filter((q) => q.material && !answered(q)).length;
  return (
    <>
      <div className="grid gap-1">
        <h3 tabIndex={-1} className="text-section">
          {plural(draft.questions.length, 'question')} first
        </h3>
        <p className="text-ink-2 max-w-[65ch]">Stint drafted the spec. These answers change what gets built, so it asks before you see the draft. Each answer becomes a decision on the new task or goal.</p>
      </div>
      {draft.questions.map((q) => (
        <QuestionCard key={q.id} q={q} answer={draft.answers.find((a) => a.question === q.id)} onAnswer={onAnswer} />
      ))}
      {rest ? (
        <Button className="justify-self-start" onClick={onRecommended} data-testid="builder-recommended">
          Use the recommended answers{left ? `, ${left} still ${left === 1 ? 'needs' : 'need'} you` : ''}
        </Button>
      ) : null}
      <p className="stint-field-help max-w-[65ch]">
        {refined ? '' : 'Refine folds your answers into the draft and may ask one more round. '}Continue goes to the draft; a question left open waits on the new task or goal, where you can answer it later.
      </p>
    </>
  );
}

function QuestionCard({ q, answer, onAnswer }: { q: Question; answer?: DraftAnswer; onAnswer: (a: DraftAnswer) => void }) {
  const [own, setOwn] = useState(answer?.text ?? '');
  const mine = () => own.trim() && onAnswer({ question: q.id, text: own.trim() });
  return (
    <div data-testid={`builder-question-${q.id}`} className="p-4 rounded-[5px] border border-rule">
      <fieldset className="grid min-w-0 gap-3">
        <legend className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-small text-ink-3">{q.id}</span>
          <span className="font-medium">{q.text}</span>
          {q.material && !answer ? <StatusChip label="Needs your answer" tone="warn" /> : null}
        </legend>
        <p className="text-small text-ink-2">What Stint found: {q.evidence}</p>
        <div className="grid gap-2">
          {q.options.map((o, i) => {
            const chosen = answer?.choice === o.label && !answer.text;
            const rec = o.label === q.recommendation.option;
            return (
              <button key={o.label} type="button" aria-pressed={chosen} onClick={() => onAnswer({ question: q.id, choice: o.label })} className={cx('grid gap-0.5 p-2.5 rounded-[5px] border text-left cursor-pointer', chosen ? 'border-ink bg-surface-selected' : 'border-rule hover:border-ink-3 hover:bg-surface-hover')}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {LETTERS[i]}. {o.label}
                  </span>
                  {rec ? <StatusChip label="recommended" tone="recommend" /> : null}
                  {chosen ? <StatusChip label="your answer" tone="good" /> : null}
                </span>
                <span className="text-small text-ink-2">{o.consequence}</span>
                {rec ? <span className="text-small text-ink-2">Why: {q.recommendation.why}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5 stint-field-label">
            Something else
            <input value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mine()} maxLength={1000} className="stint-input font-normal" />
          </label>
          <Button disabled={!own.trim()} onClick={mine}>
            Answer with this
          </Button>
        </div>
        {answer?.text ? (
          <p className="text-small">
            <span className="text-ink-2">Your answer: </span>
            {answer.text}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}

/** A visual proof's page and what should be seen there, split at the first " :: " so either part can be typed while the other is empty. */
function pageAndSeen(ref: string): [string, string] {
  const at = ref.indexOf(' :: ');
  return at < 0 ? [ref, ''] : [ref.slice(0, at), ref.slice(at + 4)];
}

/** How a task's scenario is proven: a held-out test the agent cannot see, or what a page shows, with the page and what should be seen there. */
function ProofField({ scenario: x, onChange }: { scenario: DraftScenario; onChange: (proof: DraftProof) => void }) {
  const visual = x.proof?.kind === 'visual' ? pageAndSeen(x.proof.ref ?? '') : null;
  const look = (page: string, seen: string) => onChange({ kind: 'visual', ref: `${page} :: ${seen}` });
  return (
    <>
      <label className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3">
        <span className="text-small text-ink-2">Proof</span>
        <select value={visual ? 'visual' : 'scenario'} onChange={(e) => (e.target.value === 'visual' ? look('/', x.then.slice(0, SEEN_MAX)) : onChange({ kind: 'scenario' }))} className="stint-input">
          <option value="scenario">A test the agent cannot see</option>
          <option value="visual">It looks right</option>
        </select>
      </label>
      {visual ? (
        <div className="grid gap-2 sm:pl-[60px] sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <label className="grid gap-1">
            <span className="text-small text-ink-2">Page</span>
            <input value={visual[0]} onChange={(e) => look(e.target.value, visual[1])} required pattern="/\S*" title="A path on the app, starting with /, such as /admin" placeholder="/admin" maxLength={PAGE_MAX} spellCheck={false} className="stint-input font-mono" />
          </label>
          <label className="grid gap-1">
            <span className="text-small text-ink-2">What should be seen there</span>
            <input value={visual[1]} onChange={(e) => look(visual[0], e.target.value)} required maxLength={SEEN_MAX} className="stint-input" />
          </label>
          <p className="stint-field-help sm:col-span-2">After the tests pass, Stint opens this page and checks that this is what is on screen.</p>
        </div>
      ) : null}
    </>
  );
}

/** Step 3: the draft as fields, the task or goal switch with the reason for the one preselected, and the stories with their scenarios. */
function DraftForm({ id, draft: d, edit, onSubmit }: { id: string; draft: Draft; edit: (fn: (d: Draft) => Draft) => void; onSubmit: (e: FormEvent) => void }) {
  const set = (patch: Partial<Draft>) => edit((now) => ({ ...now, ...patch }));
  // the draft's reason is for the kind it chose; switched to the other kind, the reason says it was your choice
  const suggested = useRef({ kind: d.kind, why: d.kindReason });
  const setScenario = (i: number, j: number, patch: Partial<DraftScenario>) => edit((now) => ({ ...now, stories: now.stories.map((s, k) => (k === i ? { ...s, scenarios: s.scenarios.map((x, m) => (m === j ? { ...x, ...patch } : x)) } : s)) }));
  return (
    <form id={`${id}-draft`} className="grid gap-6" onSubmit={onSubmit} data-testid="builder-draft">
      <div className="grid gap-1">
        <h3 tabIndex={-1} className="text-section">
          The draft
        </h3>
        <p className="text-ink-2 max-w-[65ch]">Change anything before you create it. Nothing is written until you do.</p>
      </div>
      <fieldset className="grid min-w-0 gap-2">
        <legend className="stint-field-label mb-2">Make it</legend>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="inline-flex gap-0.5 p-0.5 rounded-[5px] border border-rule-strong">
            {(['task', 'goal'] as const).map((k) => (
              <label key={k} className={cx('inline-flex items-center gap-2 min-h-9 px-3 rounded-[3px] font-medium cursor-pointer', d.kind === k ? 'bg-surface-selected text-ink' : 'text-ink-2 hover:text-ink')}>
                <input type="radio" name={`${id}-kind`} value={k} checked={d.kind === k} onChange={() => set({ kind: k, kindReason: k === suggested.current.kind ? suggested.current.why : `You asked for a ${k}.` })} aria-describedby={`${id}-kind-why`} />
                {k === 'task' ? 'Task' : 'Goal'}
              </label>
            ))}
          </div>
          <p id={`${id}-kind-why`} className="stint-field-help min-w-0 flex-1 basis-56" data-testid="builder-kind-why">
            {d.kindReason}
          </p>
        </div>
      </fieldset>
      <Field id={`${id}-title`} label="Title">
        <input id={`${id}-title`} value={d.title} onChange={(e) => set({ title: e.target.value })} required maxLength={120} className="stint-input" />
      </Field>
      <Field id={`${id}-summary`} label="Summary: what and why">
        <textarea id={`${id}-summary`} value={d.summary} onChange={(e) => set({ summary: e.target.value })} required maxLength={1000} rows={3} className="stint-input min-h-0" />
      </Field>
      <section className="grid gap-3" aria-labelledby={`${id}-stories`}>
        <div className="grid gap-1">
          <h3 id={`${id}-stories`} className="stint-field-label">
            Stories
          </h3>
          <p className="stint-field-help">{d.kind === 'goal' ? 'Each story becomes one proposed task of the goal, P1 first. You check them before any is made.' : 'Each scenario becomes one acceptance line of the task, P1 first.'}</p>
        </div>
        {d.stories.map((s, i) => (
          <fieldset key={i} data-testid={`builder-story-${i + 1}`} className="grid min-w-0 gap-4 p-4 rounded-[5px] border border-rule">
            <legend className="px-1 font-semibold">
              Story {i + 1}, {s.priority}
            </legend>
            <Field id={`${id}-story-${i}`} label="Title">
              <input id={`${id}-story-${i}`} value={s.title} onChange={(e) => edit((now) => ({ ...now, stories: now.stories.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) }))} required maxLength={120} className="stint-input" />
            </Field>
            <p className="stint-field-help">Why: {s.why}</p>
            {s.scenarios.map((x, j) => (
              <fieldset key={j} className="grid min-w-0 gap-2">
                <legend className="stint-field-label mb-2">Scenario {j + 1}</legend>
                {PARTS.map(([part, word]) => (
                  <label key={part} className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3">
                    <span className="text-small text-ink-2">{word}</span>
                    <input value={x[part]} onChange={(e) => setScenario(i, j, { [part]: e.target.value })} required maxLength={300} className="stint-input" />
                  </label>
                ))}
                {d.kind === 'task' ? <ProofField scenario={x} onChange={(proof) => setScenario(i, j, { proof })} /> : null}
              </fieldset>
            ))}
          </fieldset>
        ))}
      </section>
      <Field id={`${id}-success`} label="Success criteria, one per line" hint={d.kind === 'goal' ? 'A goal needs at least one. They become its criteria.' : 'Kept in the spec.md; a task is proven by its scenarios.'}>
        <textarea id={`${id}-success`} value={d.success.map((s) => s.text).join('\n')} onChange={(e) => set({ success: asLines(e.target.value).map((text, i) => ({ id: sc(i), text })) })} required={d.kind === 'goal'} rows={3} aria-describedby={`${id}-success-hint`} className="stint-input min-h-0" />
      </Field>
      <Field id={`${id}-non-goals`} label="Not in scope, one per line">
        <textarea id={`${id}-non-goals`} value={d.nonGoals.join('\n')} onChange={(e) => set({ nonGoals: asLines(e.target.value) })} rows={2} className="stint-input min-h-0" />
      </Field>
      <Field id={`${id}-assumptions`} label="Assumptions, one per line">
        <textarea id={`${id}-assumptions`} value={d.assumptions.join('\n')} onChange={(e) => set({ assumptions: asLines(e.target.value) })} rows={2} className="stint-input min-h-0" />
      </Field>
    </form>
  );
}
