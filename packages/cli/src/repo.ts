import { resolve } from 'node:path';

/** The repository Stint works on: `--repo`, else the git top level of the cwd, else the cwd. */
export function repoRoot(flag?: string): string {
  if (flag) return resolve(flag);
  const r = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { stdout: 'pipe', stderr: 'ignore' });
  return r.exitCode === 0 ? r.stdout.toString().trim() : process.cwd();
}
