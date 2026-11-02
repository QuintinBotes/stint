const ADDRESSES = new Set(['127.0.0.1', '0.0.0.0']);

/**
 * The address from `--bind` or STINT_BIND. Every client dials 127.0.0.1, so only the two addresses that keep it
 * reachable are taken: loopback, and every IPv4 address inside a container (ADR-0012).
 */
export function bindAddress(value: string): string {
  if (!ADDRESSES.has(value)) throw new Error(`--bind takes 127.0.0.1 or 0.0.0.0, not ${value}: every client reaches the daemon on 127.0.0.1`);
  return value;
}

/** The line printed on every start that listens beyond loopback, which only a container should do. */
export function bindWarning(address: string): string | null {
  if (address === '127.0.0.1') return null;
  return `The daemon listens on ${address}, beyond loopback. Publish its port on 127.0.0.1 only; docs/docker.md says why.`;
}
