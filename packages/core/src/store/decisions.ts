import { appendFile, readFile } from 'node:fs/promises';
import { KeyedQueue } from './files';

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

function parse(md: string): Decision[] {
  const out: Decision[] = [];
  let cur: Decision | null = null;
  const text: string[] = [];
  const close = () => {
    if (cur) out.push({ ...cur, text: text.join('\n').trim() });
    text.length = 0;
  };
  for (const line of md.split('\n')) {
    const h = HEADER.exec(line);
    if (h) {
      close();
      cur = { id: h[1] as string, recordedAt: h[2] as string, by: h[3] as string, text: '', evidence: [], validTo: null };
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
      if (d.supersedes && !all.some((x) => x.id === d.supersedes)) {
        throw new Error(`${d.supersedes} is not a decision of ${this.task}`);
      }
      const n = all.reduce((max, x) => Math.max(max, Number(x.id.slice(1))), 0) + 1;
      const entry: Decision = {
        id: `D${n}`,
        recordedAt: new Date().toISOString(),
        by: d.by.replace(/\s+/g, ' ').trim(),
        text: d.text.trim(),
        evidence: d.evidence ?? [],
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
