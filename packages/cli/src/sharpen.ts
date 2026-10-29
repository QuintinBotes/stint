import { type Goal, ProofKindSchema, type SharpenState, type Task, type TaskProof } from '@stint-dev/core';
import { defineCommand } from 'citty';
import { getDaemon, postDaemon } from './client';
import { repoRoot } from './repo';

const repoArg = { repo: { type: 'string', description: 'Repository root (default: the git top level)' } } as const;
const LETTERS = 'ABCD';
type Question = SharpenState['questions'][number];

/** The option a letter names (A to D, either case), or null when the words are an answer of their own. */
export function optionFor(q: Question, said: string): string | null {
  const i = /^[a-d]$/i.test(said) ? LETTERS.indexOf(said.toUpperCase()) : -1;
  return q.options[i]?.label ?? null;
}

export function questionText(q: Question): string {
  return [
    `${q.id}${q.material ? ': needs your answer' : ''}`,
    q.text,
    `What Stint found: ${q.evidence}`,
    ...q.options.map((o, i) => `  ${LETTERS[i]}) ${o.label}: ${o.consequence}${o.label === q.recommendation.option ? ` (recommended: ${q.recommendation.why})` : ''}`),
    q.safeDefault.exists ? `Safe default: ${q.safeDefault.option ?? 'yes'}${q.safeDefault.why ? `. ${q.safeDefault.why}` : ''}` : 'No safe default: a wrong answer is costly to undo.',
    q.blocks.length ? `Blocks criteria ${q.blocks.join(', ')}.` : 'Blocks no criterion.',
  ].join('\n');
}

function summary(st: SharpenState, proofsAt: string): string {
  const left = st.openMaterial.length;
  return [
    ...(st.assumed.length ? ['Assumed:', ...st.assumed.map((a) => `  ${a.id} ${a.changed ? `${a.changed.text} (changed, ${a.changed.decision})` : a.text}`)] : []),
    st.proofs.missing.length ? `Criteria with no accepted proof: ${st.proofs.missing.join(', ')}. ${proofsAt}` : 'Every criterion has an accepted proof.',
    st.ready ? 'Ready: every criterion has a proof and nothing waits on you.' : left ? `${left} question${left === 1 ? '' : 's'} still need${left === 1 ? 's' : ''} your answer.` : 'No question waits on you.',
  ].join('\n');
}

export const sharpenCommand = defineCommand({
  meta: { name: 'sharpen', description: 'Answer the few questions that change what gets built, before work starts' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id, e.g. T-0042' },
    recommended: { type: 'boolean', description: 'Take the recommendation for every question that is not material' },
    json: { type: 'boolean', description: 'Machine-readable output; asks nothing' },
    ...repoArg,
  },
  async run({ args }) {
    await sharpenAt(repoRoot(args.repo), `/api/tasks/${args.task}/sharpen`, args, 'See them with: stint proofs <task>');
  },
});

/**
 * One sharpen session at a task's or a goal's sharpen route: a new round when nothing is open, the recommendations
 * when asked, then each open question at the prompt, or the state as JSON.
 */
export async function sharpenAt(root: string, path: string, o: { recommended?: boolean; json?: boolean }, proofsAt: string): Promise<void> {
  let st = await getDaemon<SharpenState>(root, path);
  // a new round only when nothing from the last one is still open
  if (st.open.length === 0) st = await postDaemon<SharpenState>(root, path, {});
  if (o.recommended) {
    await postDaemon(root, `${path}/recommended`, {});
    st = await getDaemon<SharpenState>(root, path);
  }
  if (o.json) {
    process.stdout.write(`${JSON.stringify(st)}\n`);
    return;
  }
  const lines = console[Symbol.asyncIterator]();
  for (const q of st.questions.filter((x) => st.open.includes(x.id))) {
    const rec = LETTERS[q.options.findIndex((opt) => opt.label === q.recommendation.option)];
    process.stdout.write(`\n${questionText(q)}\nAnswer with a letter, your own words, or Enter for ${rec}: `);
    const line = await lines.next();
    if (line.done) break;
    const said = String(line.value).trim();
    const option = said ? optionFor(q, said) : q.recommendation.option;
    const r = await postDaemon<{ decision: string }>(root, `${path}/answer`, option ? { question: q.id, option } : { question: q.id, text: said });
    process.stdout.write(`Recorded as ${r.decision}.\n`);
  }
  process.stdout.write(`\n${summary(await getDaemon<SharpenState>(root, path), proofsAt)}\n`);
}

export const answerCommand = defineCommand({
  meta: { name: 'answer', description: 'Answer a sharpen question, or change an assumption, as a decision' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id, or a goal id such as G-0001' },
    id: { type: 'positional', required: true, description: 'A question such as Q1, or an assumption such as A1' },
    answer: { type: 'positional', required: true, description: 'A letter for an option, or your own words' },
    json: { type: 'boolean', description: 'Machine-readable output' },
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const path = `/api/${/^G-/.test(args.task) ? 'goals' : 'tasks'}/${args.task}/sharpen`;
    const said = (args._ as string[]).slice(2).join(' ').trim() || args.answer;
    const q = (await getDaemon<SharpenState>(root, path)).questions.find((x) => x.id === args.id);
    const option = q ? optionFor(q, said) : null;
    const body = /^A[0-9]+$/.test(args.id) ? { assumption: args.id, text: said } : option ? { question: args.id, option } : { question: args.id, text: said };
    const r = await postDaemon<{ decision: string }>(root, `${path}/answer`, body);
    process.stdout.write(args.json ? `${JSON.stringify(r)}\n` : `${args.id}: ${option ?? said}. Recorded as ${r.decision}.\n`);
  },
});

// every kind a proof may be, as the task schema has them
const KINDS = ProofKindSchema.options;
const PROOF = new RegExp(`^\\s*(\\d+)\\s*=\\s*(${KINDS.join('|')})\\s*:\\s*(.+?)\\s*$`);

/** `1=test:429 with Retry-After` as a proof; null when it does not read that way. */
export function parseProof(s: string): TaskProof | null {
  const m = PROOF.exec(s);
  return m ? { criterion: Number(m[1]), kind: m[2] as TaskProof['kind'], ref: (m[3] as string).replace(/^"(.*)"$/, '$1').slice(0, 200) } : null;
}

export const proofsCommand = defineCommand({
  meta: { name: 'proofs', description: "Show how each criterion of a task or a goal is proven, or set it" },
  args: {
    task: { type: 'positional', required: true, description: 'Task id, or a goal id such as G-0001' },
    set: { type: 'string', description: `A proof as <criterion>=<${KINDS.join('|')}>:<ref>, e.g. 1=test:"429 with Retry-After" or 2=visual:"/admin :: the table lists 3 tenants"; separate several with ";"` },
    json: { type: 'boolean', description: 'Machine-readable output' },
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const base = `/api/${/^G-/.test(args.task) ? 'goals' : 'tasks'}/${args.task}`;
    // a goal keeps each criterion's proof on the criterion; a task keeps them beside its acceptance
    const subject = /^G-/.test(args.task) ? (await getDaemon<{ goal: Goal }>(root, base)).goal : (await getDaemon<{ task: Task }>(root, base)).task;
    const criteria = 'criteria' in subject ? subject.criteria.map((c) => c.text) : subject.acceptance;
    let accepted = 'criteria' in subject ? subject.criteria.flatMap((c, i) => (c.proof ? [{ criterion: i + 1, ...c.proof }] : [])) : (subject.proofs ?? []);
    const sets = (args.set ?? '').split(';').filter((s) => s.trim());
    if (sets.length) {
      const parsed = sets.map((s) => ({ s, p: parseProof(s) }));
      const bad = parsed.find((x) => !x.p);
      if (bad) {
        process.stderr.write(`"${bad.s}" is not a proof. Write it as 1=test:"429 with Retry-After"; the kind is ${KINDS.slice(0, -1).join(', ')} or ${KINDS.at(-1)}.\n`);
        process.exit(1);
      }
      // one proof per criterion: what is given replaces what was there, and the last one given wins
      const merged = new Map([...accepted, ...parsed.map((x) => x.p as TaskProof)].map((p) => [p.criterion, p]));
      accepted = (await postDaemon<{ proofs: TaskProof[] }>(root, `${base}/proofs`, { proofs: [...merged.values()] })).proofs;
    }
    const st = await getDaemon<SharpenState>(root, `${base}/sharpen`);
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ accepted, suggested: st.proofs.suggested, missing: st.proofs.missing })}\n`);
      return;
    }
    const rows = criteria.map((text, i) => {
      const a = accepted.find((p) => p.criterion === i + 1);
      const s = st.proofs.suggested.find((p) => p.criterion === i + 1);
      const how = a ? `${a.kind}: ${a.ref}` : s ? `suggested ${s.kind}: ${s.ref} (not accepted; set it with --set ${i + 1}=${s.kind}:"${s.ref}")` : 'no proof yet';
      return `${i + 1}. ${text}\n   ${how}`;
    });
    process.stdout.write(`${rows.join('\n')}\n`);
  },
});
