import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Stint's own measured results: the bench and the golden set, both run on the demo fixture. */
export const STINT_BENCH = join(import.meta.dir, '..', '..', '..', 'bench');

/** True when this repository has the commit Stint's own bench ran on, so Stint's results describe its code. */
export async function measuredHere(root: string): Promise<boolean> {
  const path = join(STINT_BENCH, 'results.json');
  if (!existsSync(path)) return false;
  const commit = ((await Bun.file(path).json().catch(() => ({}))) as { commit?: unknown }).commit;
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(commit)) return false;
  return (await Bun.spawn(['git', 'cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited) === 0;
}
