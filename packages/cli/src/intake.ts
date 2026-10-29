import { defineCommand } from 'citty';
import { postDaemon } from './client';
import { repoRoot } from './repo';

const repoArg = { repo: { type: 'string', description: 'Repository root (default: the git top level)' } } as const;

/** Pulls issues into the intake queue; nothing becomes a task until you accept it on the board (R-041). */
async function report(root: string, body: Record<string, string | undefined>) {
  const r = await postDaemon<{ received: string[]; triaged: number }>(root, '/api/intake/pull', Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
  process.stdout.write(r.received.length ? `${r.received.length} new in the intake queue (${r.triaged} triaged): ${r.received.join(', ')}. Accept, merge or dismiss them on the board or with stint intake accept|merge|dismiss <item>.\n` : 'Nothing new.\n');
}

const github = defineCommand({
  meta: { name: 'github', description: 'Pull open GitHub issues (through gh) into the intake queue' },
  args: { 'gh-repo': { type: 'string', description: 'owner/name, if not the repository here' }, label: { type: 'string', description: 'Only issues with this label' }, ...repoArg },
  run: ({ args }) => report(repoRoot(args.repo), { source: 'github', repo: args['gh-repo'], label: args.label }),
});

const linear = defineCommand({
  meta: { name: 'linear', description: 'Pull open Linear issues into the intake queue' },
  args: { team: { type: 'string', description: 'A team key, such as ENG' }, ...repoArg },
  run: ({ args }) => report(repoRoot(args.repo), { source: 'linear', team: args.team }),
});

const item = { item: { type: 'positional', required: true, description: 'An intake item, such as github-41' } } as const;

const accept = defineCommand({
  meta: { name: 'accept', description: 'Make an intake item a task, from its triage or the title, goal and checks you give' },
  args: { ...item, title: { type: 'string', description: 'The task title' }, goal: { type: 'string', description: 'What done looks like' }, accept: { type: 'string', description: 'Acceptance criteria, separated by ";"' }, ...repoArg },
  async run({ args }) {
    const acceptance = args.accept?.split(';').map((s) => s.trim()).filter(Boolean);
    const r = await postDaemon<{ task: string }>(repoRoot(args.repo), `/api/intake/${args.item}/accept`, { ...(args.title ? { title: args.title } : {}), ...(args.goal ? { goal: args.goal } : {}), ...(acceptance?.length ? { acceptance } : {}) });
    process.stdout.write(`${args.item} is now ${r.task}.\n`);
  },
});

const merge = defineCommand({
  meta: { name: 'merge', description: 'Put an intake item on the task that already covers it' },
  args: { ...item, into: { type: 'string', required: true, description: 'The task it belongs to' }, ...repoArg },
  async run({ args }) {
    const r = await postDaemon<{ task: string }>(repoRoot(args.repo), `/api/intake/${args.item}/merge`, { task: args.into });
    process.stdout.write(`${args.item} is merged into ${r.task}.\n`);
  },
});

const dismiss = defineCommand({
  meta: { name: 'dismiss', description: 'Drop an intake item; it is never pulled again' },
  args: { ...item, reason: { type: 'string', description: 'Why it is dropped' }, ...repoArg },
  async run({ args }) {
    await postDaemon(repoRoot(args.repo), `/api/intake/${args.item}/dismiss`, args.reason ? { reason: args.reason } : {});
    process.stdout.write(`${args.item} is dismissed.\n`);
  },
});

export const intake = defineCommand({
  meta: { name: 'intake', description: 'Bring issues from GitHub or Linear into Stint, triaged, and accept, merge or dismiss them' },
  subCommands: { github, linear, accept, merge, dismiss },
});
