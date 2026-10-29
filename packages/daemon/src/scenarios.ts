import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { type Workspace, writeFileAtomic } from '@stint-dev/core/node';
import { DaemonError } from './errors';

/** The folder that holds every task's held-out scenarios, or this task's own when `config.scenarios.dir` names `<task>`. */
export function scenariosRoot(ws: Workspace, taskId: string): string {
  return resolve(ws.root, (ws.config.scenarios?.dir ?? '.stint/scenarios').replaceAll('<task>', taskId));
}

/** Where a task's held-out scenarios live: `config.scenarios.dir/<task>/`, under `.stint/scenarios` by default (R-037). */
export function scenariosDir(ws: Workspace, taskId: string): string {
  const root = scenariosRoot(ws, taskId);
  return ws.config.scenarios?.dir?.includes('<task>') ? root : join(root, taskId);
}

/** The scenario files of a task, as paths relative to its scenario folder (the layout they are copied in with). */
export async function listScenarioFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path);
      else if (e.isFile()) out.push(path);
    }
  };
  await walk('');
  return out;
}

/** A scenario path stays inside the task's scenario folder and inside the checkout it is copied into. */
export function scenarioName(name: string): string {
  const clean = name.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((p) => p === '..' || p === '' || p === '.')) {
    throw new DaemonError('invalid', `bad scenario name ${name}`, 'a relative path like holdout.test.ts or test/holdout.test.ts');
  }
  if (clean.startsWith('.stint/')) throw new DaemonError('invalid', `bad scenario name ${name}`, 'scenarios are copied into a checkout of the repository, not into .stint');
  return clean;
}

/** Stores one held-out scenario for a task. The daemon is the only writer of `.stint/`, so the CLI stores through here. */
export async function storeScenario(ws: Workspace, taskId: string, name: string, content: string): Promise<string> {
  await ws.readTask(taskId);
  const clean = scenarioName(name);
  const path = join(scenariosDir(ws, taskId), clean);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, content);
  return clean;
}
