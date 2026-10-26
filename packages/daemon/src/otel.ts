// The OTLP exporter (R-043): spans for each run go to `otel.endpoint` in batches, off the run's path. A collector
// that is down or slow costs a log line, never a run.
import { type OtlpSpan, otlpBody, taskSpans } from '@stint-dev/core/node';
import type { DaemonContext } from './app';

const BATCH = 50;
const EVERY_MS = 2_000;

/** `OTEL_EXPORTER_OTLP_HEADERS` style: `key=value,key2=value2`, values URL-encoded. */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? '').split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[decodeURIComponent(part.slice(0, i).trim())] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const tracesUrl = (endpoint: string) => (endpoint.replace(/\/+$/, '').endsWith('/v1/traces') ? endpoint.replace(/\/+$/, '') : `${endpoint.replace(/\/+$/, '')}/v1/traces`);

export class OtelExporter {
  private queue: OtlpSpan[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> = Promise.resolve();

  constructor(private readonly ctx: DaemonContext) {}

  private get config() {
    return this.ctx.ws.config.otel;
  }

  /** Queues a finished run's span and its tool calls. */
  async run(task: string, run: string): Promise<void> {
    if (!this.config?.endpoint) return;
    const t = await this.ctx.ws.readTask(task);
    this.push(taskSpans(t, await this.ctx.ws.events(task).read(), { only: run }));
  }

  /** Queues the task's own span, once it has ended. */
  async task(task: string): Promise<void> {
    if (!this.config?.endpoint) return;
    const t = await this.ctx.ws.readTask(task);
    this.push(taskSpans(t, await this.ctx.ws.events(task).read(), { runs: false, withTask: true }));
  }

  private push(spans: OtlpSpan[]): void {
    this.queue.push(...spans);
    if (this.queue.length >= BATCH) void this.flush();
    else if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), EVERY_MS);
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.send());
    return this.flushing;
  }

  private async send(): Promise<void> {
    const endpoint = this.config?.endpoint;
    if (!endpoint || this.queue.length === 0) {
      if (this.timer && this.queue.length === 0) {
        clearInterval(this.timer);
        this.timer = null;
      }
      return;
    }
    const batch = this.queue.splice(0, BATCH);
    const headers = { 'Content-Type': 'application/json', ...parseHeaders(this.config?.headersEnv ? process.env[this.config.headersEnv] : undefined) };
    try {
      const res = await fetch(tracesUrl(endpoint), { method: 'POST', headers, body: JSON.stringify(otlpBody(batch, this.config?.serviceName ?? 'stint', this.ctx.opts.version)), signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`the collector answered ${res.status}`);
    } catch (err) {
      process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', message: `otel: ${batch.length} spans were not exported: ${err instanceof Error ? err.message : String(err)}` })}\n`);
    }
    if (this.queue.length) return this.send();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}
