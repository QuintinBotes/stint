import { type MetricsInput, type Workspace } from '@stint-dev/core/node';
import { readGoldenSummary } from './gates';
import { listSkills } from './skills';

/** The workspace as metrics() reads it: every task with its log, the skill book and the golden numbers. */
export async function loadMetricsInput(ws: Workspace): Promise<Omit<MetricsInput, 'now' | 'window' | 'by'>> {
  const tasks = [];
  for (const task of await ws.listTasks()) {
    tasks.push({ task, events: await ws.events(task.id).read().catch(() => []) });
  }
  const golden = await readGoldenSummary(ws.root);
  const records = await listSkills(ws).catch(() => []);
  return {
    tasks,
    skills: { skills: records.map((s) => ({ id: s.id, status: s.status, applied: s.appliedIn.length, helped: s.helped, hurt: s.hurt })) },
    golden: golden ? { k: golden.k, passAt1: golden.passAt1, passPowK: golden.passPowK, tasks: golden.tasks } : null,
    config: ws.config,
  };
}
