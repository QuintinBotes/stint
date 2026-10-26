import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { monotonicFactory } from 'ulid';
import { canonicalJSON, sha256Hex } from '../canonical';
import { type NewEvent, type StintEvent, StintEventSchema, classifyEvent } from '../schemas/event';
import { KeyedQueue } from './files';

export const GENESIS = '0'.repeat(64);
const ulid = monotonicFactory();
const queue = new KeyedQueue();
const instances = new Map<string, EventLog>();

/** The hash chain (ported from an earlier terminal project's run.rs): NUL-separated canonical fields plus the previous hash. */
export function eventHash(e: Pick<StintEvent, 'seq' | 'ts' | 'task' | 'run' | 'adapter' | 'type' | 'payload'>, prev: string): string {
  return sha256Hex(
    [String(e.seq), e.ts, e.task, e.run ?? '', e.adapter ?? '', e.type, canonicalJSON(e.payload), prev].join('\0'),
  );
}

type Tail = { seq: number; hash: string };

/** `events.jsonl` of one task: append-only, one JSON object per line, `seq` monotonic, hash-chained. */
export class EventLog {
  private tail: Tail | null = null;
  private listeners = new Set<(e: StintEvent) => void>();

  private constructor(readonly path: string) {}

  /** One instance per file, so the cached tail and the listeners are shared by every caller. */
  static at(path: string): EventLog {
    let log = instances.get(path);
    if (!log) {
      log = new EventLog(path);
      instances.set(path, log);
    }
    return log;
  }

  append(input: NewEvent | (Omit<NewEvent, 'type'> & { type: string })): Promise<StintEvent> {
    return queue.run(this.path, async () => {
      const tail = await this.loadTail();
      const classified = classifyEvent(input);
      const draft = { ...classified, id: ulid(), seq: tail.seq + 1, ts: new Date().toISOString() };
      const event = StintEventSchema.parse({ ...draft, prev: tail.hash, hash: eventHash(draft, tail.hash) });
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(event)}\n`, { flag: 'a' });
      this.tail = { seq: event.seq, hash: event.hash as string };
      for (const l of this.listeners) l(event);
      return event;
    });
  }

  async read(o: { since?: number } = {}): Promise<StintEvent[]> {
    const since = o.since ?? 0;
    return (await this.lines()).map((l) => JSON.parse(l) as StintEvent).filter((e) => e.seq > since);
  }

  /** Re-derives every hash; names the first row whose content, order or link is broken. */
  async verify(): Promise<{ ok: boolean; brokenAt?: number }> {
    let prev = GENESIS;
    const lines = await this.lines();
    for (let i = 0; i < lines.length; i++) {
      const at = i + 1;
      let e: StintEvent;
      try {
        e = JSON.parse(lines[i] as string) as StintEvent;
      } catch {
        return { ok: false, brokenAt: at };
      }
      if (e.seq !== at || e.prev !== prev || e.hash !== eventHash(e, prev)) return { ok: false, brokenAt: at };
      prev = e.hash;
    }
    return { ok: true };
  }

  /** In-process subscription to appends made through this instance. */
  onAppend(cb: (e: StintEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private async lines(): Promise<string[]> {
    try {
      return (await readFile(this.path, 'utf8')).split('\n').filter((l) => l.length > 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  private async loadTail(): Promise<Tail> {
    if (this.tail) return this.tail;
    const lines = await this.lines();
    const last = lines.at(-1);
    if (!last) return (this.tail = { seq: 0, hash: GENESIS });
    const e = JSON.parse(last) as StintEvent;
    return (this.tail = { seq: e.seq, hash: e.hash ?? GENESIS });
  }
}
