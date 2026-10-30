import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type Draft, type DraftAnswer, DraftSchema, formatIssues, toSpecKit } from '@stint-dev/core';
import { defineCommand } from 'citty';
import { postDaemon } from './client';
import { repeated } from './goal';
import { repoRoot } from './repo';
import { optionFor, questionText } from './sharpen';

const read = (path: string): string => {
  if (!existsSync(path)) {
    process.stderr.write(`No file at ${path}.\n`);
    process.exit(2);
  }
  return readFileSync(path, 'utf8');
};

/** A draft saved with --json, read back so its questions can be answered; anything else in --from is a Spec Kit spec. */
function savedDraft(text: string): Draft | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = DraftSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  process.stderr.write(`That JSON is not a draft:\n${formatIssues(parsed.error)}\n`);
  process.exit(2);
}

/** `Q1=A` or `Q1=your own words` as an answer to one of the draft's questions; exits with a sentence when it is neither. */
function answerFor(d: Draft, said: string): DraftAnswer {
  const m = /^(Q[0-9]+)\s*=\s*(.+)$/.exec(said);
  const q = m ? d.questions.find((x) => x.id === m[1]) : undefined;
  if (!m || !q) {
    process.stderr.write(`"${said}" names no question of this draft. Write it as Q1=A, or Q1=your own words; the questions are ${d.questions.map((x) => x.id).join(', ') || 'none'}.\n`);
    process.exit(2);
  }
  const choice = optionFor(q, (m[2] as string).trim());
  return choice ? { question: q.id, choice } : { question: q.id, text: (m[2] as string).trim() };
}

function printed(d: Draft): string {
  const answered = new Set(d.answers.map((a) => a.question));
  const open = d.questions.filter((q) => !answered.has(q.id));
  return [
    `${d.kind === 'goal' ? 'Goal' : 'Task'}: ${d.kindReason}`,
    '',
    toSpecKit(d),
    ...(open.length ? ['## Questions', '', ...open.flatMap((q) => [questionText(q), ''])] : []),
    ...(d.answers.length ? ['## Answered', '', ...d.answers.map((a) => `- ${a.question}: ${[a.choice, a.text].filter(Boolean).join(', ')}`), ''] : []),
    ...(d.assumed.length ? ['## Assumed', '', ...d.assumed.map((a) => `- ${a.id} ${a.text}`), ''] : []),
    open.length ? `Answer with --answer Q1=A (or your own words), or --recommended; save the draft with --json and answer it with --from.` : 'Create it with --create, or write it out with --out spec.md.',
  ].join('\n');
}

export const draftCommand = defineCommand({
  meta: { name: 'draft', description: "Say what you want; Stint drafts the spec in GitHub Spec Kit's shape and asks only what changes what gets built" },
  args: {
    words: { type: 'positional', required: false, description: 'What you want done, in a sentence or two' },
    goal: { type: 'boolean', description: 'Draft a goal to split into tasks, not one task' },
    task: { type: 'boolean', description: 'Draft one task, where the model might have made it a goal' },
    answer: { type: 'string', description: 'An answer as <question>=<letter or your own words>, e.g. Q1=A; give it once per answer' },
    recommended: { type: 'boolean', description: 'Take the recommendation for every open question that is not material' },
    from: { type: 'string', description: 'Open a Spec Kit spec.md instead of drafting, or a draft saved with --json' },
    tasks: { type: 'string', description: "With --from, a Spec Kit tasks.md whose phases become the goal's split" },
    create: { type: 'boolean', description: 'Create the task or the goal' },
    out: { type: 'string', description: 'Write the draft as a Spec Kit spec.md to this file' },
    json: { type: 'boolean', description: 'Print the draft as JSON' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
  },
  async run({ args, rawArgs }) {
    const root = repoRoot(args.repo);
    const words = (args._ as string[]).join(' ').trim();
    let d: Draft;
    if (args.from) {
      const text = read(args.from);
      d = savedDraft(text) ?? (await postDaemon<Draft>(root, '/api/drafts/import', { spec: text, ...(args.tasks ? { tasks: read(args.tasks) } : {}) }));
    } else if (words) d = await postDaemon<Draft>(root, '/api/drafts', { input: words, ...(args.goal ? { kind: 'goal' } : args.task ? { kind: 'task' } : {}) });
    else {
      process.stderr.write('Say what you want done, as in: stint draft "Operators can tell the service is up", or open a spec with --from spec.md.\n');
      process.exit(2);
    }
    const given = repeated(rawArgs, 'answer').map((s) => answerFor(d, s));
    const answered = new Set([...d.answers, ...given].map((a) => a.question));
    const recommended = args.recommended ? d.questions.filter((q) => !q.material && !answered.has(q.id)).map((q) => ({ question: q.id, choice: q.recommendation.option })) : [];
    const answers = [...given, ...recommended];
    if (answers.length) d = await postDaemon<Draft>(root, '/api/drafts/refine', { draft: d, answers });
    if (args.out) writeFileSync(args.out, toSpecKit(d));
    const made = args.create ? await postDaemon<{ kind: string; id: string }>(root, '/api/drafts/create', { draft: d }) : null;
    if (args.json) process.stdout.write(`${JSON.stringify(made ?? d)}\n`);
    else process.stdout.write(`${printed(d)}\n${args.out ? `Wrote ${args.out}.\n` : ''}${made ? `Created ${made.id}.\n` : ''}`);
  },
});
