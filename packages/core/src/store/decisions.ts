import { appendFile, readFile } from 'node:fs/promises';
import { KeyedQueue, StoreError } from './files';

export type Decision = {
  id: string;
  recordedAt: string;
  by: string;
  text: string;
  supersedes?: string;
  evidence: string[];
  /** When a later entry superseded this one; null while it is valid. */
  validTo: string | null;
};

export type NewDecision = { text: string; supersedes?: string; evidence?: string[]; by: string };

const queue = new KeyedQueue();
const HEADER = /^## (D[0-9]+) · (\S+) · (.+)$/;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function parse(md: string): Decision[] {
  const out: Decision[] = [];
  let cur: Decision | null = null;
  const text: string[] = [];
  const close = () => {
    if (cur) out.push({ ...cur, text: text.join('\n').trim() });
    text.length = 0;
  };
  let first = false;
  for (const line of md.split('\n')) {
    if (first) {
      // the line after a header is the entry's text, whatever it starts with
      text.push(line);
      first = false;
      continue;
    }
    const h = HEADER.exec(line);
    if (h) {
      close();
      cur = { id: h[1] as string, recordedAt: h[2] as string, by: h[3] as string, text: '', evidence: [], validTo: null };
      first = true;
    } else if (cur && line.startsWith('supersedes: ')) {
      cur.supersedes = line.slice('supersedes: '.length).trim();
    } else if (cur && line.startsWith('evidence: ')) {
      cur.evidence = line.slice('evidence: '.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (cur) {
      text.push(line);
    }
  }
  close();
  for (const d of out) {
    if (!d.supersedes) continue;
    const old = out.find((o) => o.id === d.supersedes);
    if (old && old.validTo === null) old.validTo = d.recordedAt;
  }
  return out;
}

/** `decisions.md` of one task: append-only. A reversal is a new entry with `supersedes:`; nothing is ever edited. */
export class DecisionLedger {
  constructor(
    readonly path: string,
    private readonly task: string,
  ) {}

  async read(): Promise<Decision[]> {
    return parse(await this.raw());
  }

  /** Decisions valid at `at` (default now): recorded at or before it and not yet superseded. */
  async validAt(at: string = new Date().toISOString()): Promise<Decision[]> {
    return (await this.read()).filter((d) => d.recordedAt <= at && (d.validTo === null || at < d.validTo));
  }

  append(d: NewDecision): Promise<Decision> {
    return queue.run(this.path, async () => {
      const existing = await this.raw();
      const all = parse(existing);
      const by = oneLine(d.by);
      if (!by) throw new StoreError('invalid', 'a decision needs who made it');
      const old = d.supersedes ? all.find((x) => x.id === d.supersedes) : undefined;
      if (d.supersedes && !old) throw new StoreError('not_found', `${d.supersedes} is not a decision of ${this.task}`);
      // `you` is a person, and `goal` a goal's decision copied to its task; every other by is an agent, a run or the daemon.
      // A person's decision stands until a person reverses it.
      if ((old?.by === 'you' || old?.by === 'goal') && by !== 'you') throw new StoreError('forbidden', `${old.id} was ${old.by === 'goal' ? 'passed down by its goal' : 'recorded by a person'}, and only a person can supersede it`);
      const n = all.reduce((max, x) => Math.max(max, Number(x.id.slice(1))), 0) + 1;
      const entry: Decision = {
        id: `D${n}`,
        recordedAt: new Date().toISOString(),
        by,
        // every field on one line, so none can carry a header, supersedes: or evidence: line the parser would read as its own
        text: oneLine(d.text),
        evidence: (d.evidence ?? []).map(oneLine),
        validTo: null,
        ...(d.supersedes ? { supersedes: d.supersedes } : {}),
      };
      const lines = [
        ...(existing.length === 0 ? [`# Decisions for ${this.task}`, ''] : []),
        `## ${entry.id} · ${entry.recordedAt} · ${entry.by}`,
        entry.text,
        ...(entry.supersedes ? [`supersedes: ${entry.supersedes}`] : []),
        ...(entry.evidence.length ? [`evidence: ${entry.evidence.join(', ')}`] : []),
        '',
      ];
      const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
      await appendFile(this.path, prefix + lines.join('\n') + '\n', { flag: 'a' });
      return entry;
    });
  }

  private async raw(): Promise<string> {
    try {
      return await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    }
  }
}
