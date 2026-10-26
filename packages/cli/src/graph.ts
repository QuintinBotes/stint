import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { StoreError, Workspace, constrains, filesTogether, similar } from '@stint-dev/core/node';
import { defineCommand } from 'citty';
import { repoRoot } from './repo';

/** The graph CLI reads the workspace directly and writes nothing: cache off, no daemon needed. */
async function openWorkspace(repo?: string): Promise<Workspace> {
  const root = repoRoot(repo);
  if (!existsSync(join(root, '.stint'))) {
    process.stderr.write(`No .stint/ in ${root}. Run stint up or stint demo first.\n`);
    process.exit(1);
  }
  return Workspace.open(root);
}

async function run<T>(fn: () => Promise<T>, json: boolean | undefined, lines: (rows: T) => string[]): Promise<void> {
  try {
    const rows = await fn();
    if (json) {
      process.stdout.write(`${JSON.stringify(rows)}\n`);
      return;
    }
    for (const line of lines(rows)) process.stdout.write(`${line}\n`);
  } catch (err) {
    if (err instanceof StoreError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

const shared = {
  repo: { type: 'string', description: 'Repository root (default: the git top level)' },
  json: { type: 'boolean', description: 'Machine-readable output' },
} as const;

const similarCmd = defineCommand({
  meta: { name: 'similar', description: 'Tasks similar to this one, with the shared files, themes and tags named' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id, e.g. T-0042' },
    ...shared,
  },
  async run({ args }) {
    const ws = await openWorkspace(args.repo);
    await run(
      () => similar(ws, args.task, { cache: false }),
      args.json,
      (rows) =>
        rows.length
          ? rows.map((r) => {
              const parts = [
                r.evidence.files.length ? `files: ${r.evidence.files.join(', ')}` : '',
                r.evidence.themes.length ? `themes: ${r.evidence.themes.join(', ')}` : '',
                r.evidence.tags.length ? `tags: ${r.evidence.tags.join(', ')}` : '',
              ].filter(Boolean);
              return `${r.task} score ${r.score} ${parts.join('; ')}`;
            })
          : [`Nothing is similar to ${args.task} yet.`],
    );
  },
});

const filesTogetherCmd = defineCommand({
  meta: { name: 'files-together', description: 'Files changed in the same runs as this one, by count' },
  args: {
    path: { type: 'positional', required: true, description: 'File path, e.g. src/lib/limiter.ts' },
    ...shared,
  },
  async run({ args }) {
    const ws = await openWorkspace(args.repo);
    await run(
      () => filesTogether(ws, args.path, { cache: false }),
      args.json,
      (rows) => (rows.length ? rows.map((r) => `${r.path} ${r.count}`) : [`No file changed in the same run as ${args.path}.`]),
    );
  },
});

const constrainsCmd = defineCommand({
  meta: { name: 'constrains', description: 'Decisions and open findings that apply to this task\'s files' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id, e.g. T-0042' },
    'as-of': { type: 'string', description: 'Only what was valid at this ISO 8601 time' },
    ...shared,
  },
  async run({ args }) {
    const asOf = args['as-of'];
    if (asOf && Number.isNaN(Date.parse(asOf))) {
      process.stderr.write(`--as-of is not a time: ${asOf}\n`);
      process.exit(2);
    }
    const ws = await openWorkspace(args.repo);
    await run(
      () => constrains(ws, args.task, asOf, { cache: false }),
      args.json,
      (rows) =>
        rows.length
          ? rows.map((r) => `${r.kind} ${r.id} (${r.task}) ${r.text} files: ${r.files.join(', ')}`)
          : [`Nothing constrains ${args.task}${asOf ? ` at ${asOf}` : ''}.`],
    );
  },
});

export const graph = defineCommand({
  meta: { name: 'graph', description: 'The memory graph: what is similar, what changed together, what constrains a task' },
  subCommands: { similar: similarCmd, 'files-together': filesTogetherCmd, constrains: constrainsCmd },
});
