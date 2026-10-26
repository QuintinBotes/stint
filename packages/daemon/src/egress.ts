// The egress proxy (R-040): agents and test runs reach the network only through it, and only to allowed hosts.
// It speaks HTTP CONNECT for HTTPS and absolute-URL requests for plain HTTP. The proxy URL carries the task and
// run as credentials, so a refused connection is recorded on the run that tried it.
import { appendFileSync } from 'node:fs';
import { type Server, type Socket, connect, createServer } from 'node:net';

export type Blocked = { host: string; port: number; method: string; task: string | null; run: string | null };

/** `example.com` matches only itself; `*.example.com` matches the domain and every name under it. */
export function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  return allow.some((entry) => {
    const a = entry.toLowerCase().trim();
    if (a.startsWith('*.')) return h === a.slice(2) || h.endsWith(a.slice(1));
    return h === a;
  });
}

/** The hosts a config's model hosts live on, plus the package registry: what agents need by default. */
export function defaultAllow(hosts: Record<string, { baseURL?: string } | undefined>): string[] {
  const out = new Set(['registry.npmjs.org']);
  for (const h of Object.values(hosts)) {
    try {
      if (h?.baseURL) out.add(new URL(h.baseURL).hostname);
    } catch {
      // a host without a valid URL adds nothing
    }
  }
  return [...out];
}

const MAX_HEAD = 16 * 1024;

function credentials(head: string): { task: string | null; run: string | null } {
  const m = /^proxy-authorization:\s*basic\s+(\S+)\s*$/im.exec(head);
  if (!m) return { task: null, run: null };
  const [task, run] = Buffer.from(m[1] as string, 'base64').toString('utf8').split(':');
  return { task: /^T-\d+$/.test(task ?? '') ? (task as string) : null, run: /^r\d+$/.test(run ?? '') ? (run as string) : null };
}

function refuse(client: Socket, status: string, text: string): void {
  client.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
}

export class EgressProxy {
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  port = 0;
  private readonly allow: () => string[];
  private readonly onBlocked: (b: Blocked) => void;

  // plain fields, not parameter properties: the docker sidecar runs this file on Node, which only strips types
  constructor(allow: () => string[], onBlocked: (b: Blocked) => void) {
    this.allow = allow;
    this.onBlocked = onBlocked;
  }

  async start(port = 0, host = '127.0.0.1', background = true): Promise<number> {
    this.server = createServer((client) => this.handle(client));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, host, () => resolve());
    });
    // in the daemon the proxy never keeps the process alive on its own; as the sidecar it is the process
    if (background) this.server.unref();
    const addr = this.server.address();
    this.port = typeof addr === 'object' && addr ? addr.port : port;
    return this.port;
  }

  /** The proxy URL for one run; the credentials only name the run, they grant nothing. */
  url(task: string, run: string, host = '127.0.0.1'): string {
    return `http://${task}:${run}@${host}:${this.port}`;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  private handle(client: Socket): void {
    this.sockets.add(client);
    client.on('close', () => this.sockets.delete(client));
    client.on('error', () => client.destroy());
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) {
        if (buf.length > MAX_HEAD) refuse(client, '431 Request Header Fields Too Large', 'stint egress: request head too large\n');
        return;
      }
      client.off('data', onData);
      client.pause();
      this.route(client, buf.subarray(0, end).toString('latin1'), buf.subarray(end + 4));
    };
    client.on('data', onData);
  }

  private route(client: Socket, head: string, rest: Buffer): void {
    const [line = '', ...headers] = head.split('\r\n');
    const [method = '', target = ''] = line.split(' ');
    const who = credentials(head);
    let host: string;
    let port: number;
    let path = '/';
    if (method === 'CONNECT') {
      const i = target.lastIndexOf(':');
      host = i > 0 ? target.slice(0, i) : target;
      port = i > 0 ? Number(target.slice(i + 1)) : 443;
    } else {
      let url: URL;
      try {
        url = new URL(target);
      } catch {
        return refuse(client, '400 Bad Request', 'stint egress: send an absolute URL or CONNECT\n');
      }
      if (url.protocol !== 'http:') return refuse(client, '400 Bad Request', 'stint egress: only http and CONNECT are proxied\n');
      host = url.hostname;
      port = url.port ? Number(url.port) : 80;
      path = `${url.pathname}${url.search}`;
    }
    host = host.replace(/^\[|\]$/g, '');
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || !hostAllowed(host, this.allow())) {
      this.onBlocked({ host, port, method, ...who });
      return refuse(client, '403 Forbidden', `stint egress: ${host} is not in sandbox.egress.allow\n`);
    }
    const upstream = connect(port, host);
    this.sockets.add(upstream);
    upstream.on('close', () => {
      this.sockets.delete(upstream);
      client.destroy();
    });
    client.on('close', () => upstream.destroy());
    upstream.on('error', () => refuse(client, '502 Bad Gateway', `stint egress: could not reach ${host}:${port}\n`));
    upstream.on('connect', () => {
      if (method === 'CONNECT') {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      } else {
        // one request per connection: a kept-alive proxy connection could otherwise reach a second, unchecked host
        const kept = headers.filter((h) => !/^(proxy-authorization|proxy-connection|connection|keep-alive):/i.test(h));
        upstream.write(`${method} ${path} ${line.split(' ')[2] ?? 'HTTP/1.1'}\r\n${[...kept, 'Connection: close'].join('\r\n')}\r\n\r\n`, 'latin1');
      }
      if (rest.length) upstream.write(rest);
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
  }
}

// Run on its own, it is the sidecar a docker sandbox routes through: allowed hosts and the log of refusals come from env.
if (process.env.STINT_EGRESS_SIDECAR === '1') {
  const allow = (process.env.STINT_EGRESS_ALLOW ?? '').split(',').filter(Boolean);
  const log = process.env.STINT_EGRESS_LOG;
  const proxy = new EgressProxy(
    () => allow,
    (b) => {
      if (log) appendFileSync(log, `${JSON.stringify({ ...b, at: new Date().toISOString() })}\n`);
    },
  );
  await proxy.start(Number(process.env.STINT_EGRESS_PORT ?? 3128), '0.0.0.0', false);
}
