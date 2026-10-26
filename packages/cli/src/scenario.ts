import { existsSync, readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { daemonFor, postDaemon } from './client';
import { repoRoot } from './repo';

const repoArg = { repo: { type: 'string', description: 'Repository root (default: the git top level)' } } as const;

/**
 * What `scenario add` sends the daemon: the file's path inside the repository when it is one
 * (that is where it lands in the temporary checkout), else its base name, and its content.
 */
export function scenarioPayload(root: string, file: string): { name: string; content: string } {
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`no file ${file}`);
  const inside = relative(resolve(root), path);
  const name = inside && !inside.startsWith('..') ? inside : basename(path);
  return { name: name.replaceAll('\\', '/'), content: readFileSync(path, 'utf8') };
}

const add = defineCommand({
  meta: { name: 'add', description: 'Store a held-out scenario for a task; agents never see it' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id' },
    file: { type: 'positional', required: true, description: 'The scenario test file' },
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    let payload: { name: string; content: string };
    try {
      payload = scenarioPayload(root, args.file);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
    const r = await postDaemon<{ name: string }>(root, `/api/tasks/${args.task}/scenarios`, payload);
    process.stdout.write(`Stored ${r.name} as a held-out scenario for ${args.task}. It runs after the tests, in a checkout no agent sees.\n`);
  },
});

const list = defineCommand({
  meta: { name: 'list', description: 'The held-out scenarios stored for a task, by name' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id' },
    json: { type: 'boolean', description: 'Machine-readable output' },
    ...repoArg,
  },
  async run({ args }) {
    const d = daemonFor(repoRoot(args.repo));
    const res = await fetch(`${d.url}/api/tasks/${args.task}/scenarios`);
    if (!res.ok) {
      process.stderr.write(`the daemon refused the scenario list (HTTP ${res.status})\n`);
      process.exit(1);
    }
    const { names } = (await res.json()) as { names: string[] };
    if (args.json) {
      process.stdout.write(`${JSON.stringify(names)}\n`);
      return;
    }
    process.stdout.write(names.length ? `${names.join('\n')}\n` : `No held-out scenarios for ${args.task}.\n`);
  },
});

export const scenario = defineCommand({
  meta: { name: 'scenario', description: 'Held-out scenarios: tests the builder never sees, run by the daemon after the tests' },
  subCommands: { add, list },
});
