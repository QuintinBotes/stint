import { appendFile, copyFile, mkdir, readFile, stat, truncate } from 'node:fs/promises';
import { dirname } from 'node:path';
import { monotonicFactory } from 'ulid';
import { canonicalJSON, sha256Hex } from '../canonical';
import { scrubSecrets } from '../keys';
import { type NewEvent, type StintEvent, StintEventSchema, classifyEvent } from '../schemas/event';
import { KeyedQueue } from './files';

export const GENESIS = '0'.repeat(64);
const ulid = monotonicFactory();
const queue = new KeyedQueue();
const instances = new Map<string, EventLog>();
const anyListeners = new Set<(e: StintEvent) => void>();
/** What a person typed and what a tool printed can hold a credential; it is redacted before it is stored (R-040). */
const SCRUBBED = new Set(['human.command', 'agent.tool_result']);
const scrubDeep = (v: unknown): unknown =>
  typeof v === 'string' ? scrubSecrets(v) : Array.isArray(v) ? v.map(scrubDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)])) : v;

/** The hash chain: NUL-separated canonical fields plus the previous hash. */
export function eventHash(e: Pick<StintEvent, 'seq' | 'ts' | 'task' | 'run' | 'adapter' | 'type' | 'payload'>, prev: string): string {
  return sha256Hex(
    [String(e.seq), e.ts, e.task, e.run ?? '', e.adapter ?? '', e.type, canonicalJSON(e.payload), prev].join('\0'),
  );
}

type Tail = { seq: number; hash: string };

/** `events.jsonl` of one task: append-only, one JSON object per line, `seq` monotonic, hash-chained. */
export class EventLog {
  private tail: Tail | null = null;
  /** Every event, parsed once, with the size and time of the file it was parsed from. */
  private cache: { size: number; mtimeMs: number; events: StintEvent[] } | null = null;
  private warned = false;
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
      const typed = classifyEvent(input);
      const classified = SCRUBBED.has(typed.type) ? { ...typed, payload: scrubDeep(typed.payload) as Record<string, unknown> } : typed;
      const draft = { ...classified, id: ulid(), seq: tail.seq + 1, ts: new Date().toISOString() };
      const event = StintEventSchema.parse({ ...draft, prev: tail.hash, hash: eventHash(draft, tail.hash) });
      await mkdir(dirname(this.path), { recursive: true });
      const line = `${JSON.stringify(event)}\n`;
      await appendFile(this.path, line, { flag: 'a' });
      this.tail = { seq: event.seq, hash: event.hash as string };
      // the daemon is the only writer: the cached events grow with the file, unless someone else wrote to it too
      const st = await stat(this.path);
      if (this.cache && this.cache.size + Buffer.byteLength(line) === st.size) {
        this.cache.events.push(event);
        this.cache.size = st.size;
        this.cache.mtimeMs = st.mtimeMs;
      } else this.cache = null;
      for (const l of this.listeners) l(event);
      for (const l of anyListeners) l(event);
      return event;
    });
  }

  /** The events after `since`, as a new array: callers never hold the cached one. */
  async read(o: { since?: number } = {}): Promise<StintEvent[]> {
    const since = o.since ?? 0;
    return (await queue.run(this.path, () => this.all())).filter((e) => e.seq > since);
  }

  /** Every event, parsed again only when the file's size or time no longer match the cache (a write outside the daemon). */
  private async all(): Promise<StintEvent[]> {
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.cache = null;
      return [];
    }
    if (this.cache && this.cache.size === st.size && this.cache.mtimeMs === st.mtimeMs) return this.cache.events;
    // changed under the cache: the tail is read again before the next append, too
    if (this.cache) this.tail = null;
    const text = await readFile(this.path, 'utf8');
    const events: StintEvent[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      const e = parse(line);
      if (e) events.push(e);
      else if (!this.warned) {
        // one bad line must not hide the rest of the log; verify() still names it
        this.warned = true;
        process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', message: `${this.path} has a line that is not JSON; it is skipped`, path: this.path })}\n`);
      }
    }
    this.cache = Buffer.byteLength(text) === st.size ? { size: st.size, mtimeMs: st.mtimeMs, events } : null;
    return events;
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

  /** In-process subscription to every append in this process, across all tasks (the board stream). */
  static onAnyAppend(cb: (e: StintEvent) => void): () => void {
    anyListeners.add(cb);
    return () => anyListeners.delete(cb);
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
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return (this.tail = { seq: 0, hash: GENESIS });
      throw err;
    }
    const cut = text.lastIndexOf('\n', text.length - 2) + 1;
    const last = text.slice(cut);
    if (last && !text.endsWith('\n')) {
      if (parse(last)) await appendFile(this.path, '\n');
      else {
        // a torn append from a crash: kept aside, then cut so the next append starts on a line of its own
        await copyFile(this.path, `${this.path}.torn-${new Date().toISOString().replace(/[:.]/g, '-')}`);
        await truncate(this.path, Buffer.byteLength(text.slice(0, cut)));
        text = text.slice(0, cut);
      }
    }
    const e = text.split('\n').reverse().map(parse).find((x) => x !== null);
    return (this.tail = e ? { seq: e.seq, hash: e.hash ?? GENESIS } : { seq: 0, hash: GENESIS });
  }
}

function parse(line: string): StintEvent | null {
  if (!line) return null;
  try {
    return JSON.parse(line) as StintEvent;
  } catch {
    return null;
  }
}
