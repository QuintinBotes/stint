const SESSION_MARKERS = [/^MUSE_/];

/** Names that hold credentials: the model hosts' keys stay in the daemon (R-040). */
export const CREDENTIAL = /(^|_)(KEY|TOKEN|SECRET|PASSWORD)$/i;

export type RunEnvOpts = {
  /** Credential names an agent's manifest says it needs. */
  keep?: string[];
  /** The person's own terminal keeps their credentials; nothing an agent or a test run starts does. */
  credentials?: boolean;
  /** The egress proxy URL for this run, when egress is on. */
  proxy?: string | null;
  base?: NodeJS.ProcessEnv;
};

/** The environment of anything the daemon spawns in a worktree: session markers and credentials stripped, Stint's added. */
export function runEnv(task: string, run: string, worktree: string, opts: RunEnvOpts = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.base ?? process.env)) {
    if (v === undefined || SESSION_MARKERS.some((m) => m.test(k))) continue;
    if (!opts.credentials && CREDENTIAL.test(k) && !opts.keep?.includes(k)) continue;
    env[k] = v;
  }
  if (opts.proxy) {
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) env[k] = opts.proxy;
    // the daemon itself is reached directly; everything else goes through the proxy
    env.NO_PROXY = env.no_proxy = '127.0.0.1,localhost';
    env.NODE_USE_ENV_PROXY = '1';
  }
  env.STINT_TASK = task;
  env.STINT_RUN = run;
  env.STINT_WORKTREE = worktree;
  env.TERM_PROGRAM = 'Stint';
  return env;
}
