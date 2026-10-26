import { defineCommand } from 'citty';
import { postDaemon } from './client';
import { repoRoot } from './repo';

const repoArg = { repo: { type: 'string', description: 'Repository root (default: the git top level)' } } as const;

/** Pulls issues into the intake queue; nothing becomes a task until you accept it on the board (R-041). */
async function report(root: string, body: Record<string, string | undefined>) {
  const r = await postDaemon<{ received: string[]; triaged: number }>(root, '/api/intake/pull', Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
  process.stdout.write(r.received.length ? `${r.received.length} new in the intake queue (${r.triaged} triaged): ${r.received.join(', ')}. Accept, merge or dismiss them on the board.\n` : 'Nothing new.\n');
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

export const intake = defineCommand({
  meta: { name: 'intake', description: 'Bring issues from GitHub or Linear into Stint, triaged, for you to accept' },
  subCommands: { github, linear },
});
