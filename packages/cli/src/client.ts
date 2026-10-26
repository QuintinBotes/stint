import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type DaemonInfo = { port: number; token: string; pid: number };

/** The running daemon for a repository, from `.stint/cache/daemon.json`; exits with a plain sentence when there is none. */
export function daemonFor(root: string): DaemonInfo & { url: string } {
  const path = join(root, '.stint', 'cache', 'daemon.json');
  if (!existsSync(path)) {
    process.stderr.write(`No Stint daemon is running for ${root}. Start one with: stint up\n`);
    process.exit(1);
  }
  const d = JSON.parse(readFileSync(path, 'utf8')) as DaemonInfo;
  return { ...d, url: `http://127.0.0.1:${d.port}` };
}

/** POSTs to the daemon with its token; prints the daemon's own error and exits 1 when it refuses. */
export async function postDaemon<T>(root: string, path: string, body: unknown): Promise<T> {
  const d = daemonFor(root);
  const res = await fetch(`${d.url}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: { code: string; message: string; hint: unknown } };
  if (!res.ok) {
    const e = json.error;
    process.stderr.write(`${e?.code ?? res.status}: ${e?.message ?? 'the daemon refused'}${e?.hint ? ` (${typeof e.hint === 'string' ? e.hint : JSON.stringify(e.hint)})` : ''}\n`);
    process.exit(1);
  }
  return json;
}

/** GETs from the daemon; reads need no token. */
export async function getDaemon<T>(root: string, path: string): Promise<T> {
  const d = daemonFor(root);
  const res = await fetch(`${d.url}${path}`);
  if (!res.ok) {
    process.stderr.write(`the daemon answered ${res.status} for ${path}\n`);
    process.exit(1);
  }
  return (await res.json()) as T;
}
