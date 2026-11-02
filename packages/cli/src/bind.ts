import { isIP } from 'node:net';

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** The address from `--bind` or STINT_BIND. Only an IP address is taken, so a name cannot resolve somewhere unexpected. */
export function bindAddress(value: string): string {
  if (!isIP(value)) throw new Error(`--bind takes an IP address such as 127.0.0.1 or 0.0.0.0, not ${value}`);
  return value;
}

/** The line printed on every start that listens beyond loopback, which only a container should do (ADR-0012). */
export function bindWarning(address: string): string | null {
  if (LOOPBACK.has(address)) return null;
  return `The daemon listens on ${address}, beyond loopback. Publish its port on 127.0.0.1 only; docs/docker.md says why.`;
}
