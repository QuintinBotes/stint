const SESSION_MARKERS = [/^CLAUDECODE$/, /^CLAUDE_CODE_/, /^MUSE_/];

/** The environment of anything the daemon spawns in a worktree: session markers stripped, Stint's added. */
export function runEnv(task: string, run: string, worktree: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || SESSION_MARKERS.some((m) => m.test(k))) continue;
    env[k] = v;
  }
  env.STINT_TASK = task;
  env.STINT_RUN = run;
  env.STINT_WORKTREE = worktree;
  env.TERM_PROGRAM = 'Stint';
  return env;
}
