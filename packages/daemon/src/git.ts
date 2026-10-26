export type GitResult = { code: number; stdout: string; stderr: string };

/** Runs git with an explicit cwd and argument list; never through a shell string. */
export async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<GitResult> {
  const p = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', ...(env ? { env } : {}) });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr };
}

export async function gitOk(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout;
}

/** Runs `gh` with an explicit cwd and argument list, resolved on the current PATH (tests put a fake there). */
export async function gh(cwd: string, args: string[]): Promise<GitResult> {
  const bin = Bun.which('gh', { PATH: process.env.PATH ?? '' });
  if (!bin) return { code: 127, stdout: '', stderr: 'gh is not on PATH' };
  try {
    const p = Bun.spawn([bin, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: process.env });
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, stdout, stderr };
  } catch (err) {
    return { code: 127, stdout: '', stderr: err instanceof Error ? err.message : String(err) };
  }
}

export async function ghOk(cwd: string, args: string[]): Promise<string> {
  const r = await gh(cwd, args);
  if (r.code !== 0) throw new Error(`gh ${args.join(' ')} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout;
}

export type NumstatEntry = { path: string; added: number; removed: number };

export function parseNumstat(text: string): NumstatEntry[] {
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const [a, r, ...rest] = l.split('\t');
      return { path: rest.join('\t'), added: a === '-' ? 0 : Number(a), removed: r === '-' ? 0 : Number(r) };
    });
}

/** Commit identity: the repository's own when it has one, else a neutral daemon identity. */
export async function identityArgs(cwd: string): Promise<string[]> {
  const r = await git(cwd, ['var', 'GIT_COMMITTER_IDENT']);
  return r.code === 0 ? [] : ['-c', 'user.name=Stint daemon', '-c', 'user.email=daemon@example.com'];
}
