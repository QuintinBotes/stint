import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { CostSchema, EndedBySchema, type Handoff, HandoffSchema, RUN_ID, RoleSchema } from '../schemas/handoff';
import { readJsonIfExists, writeFileAtomic, writeJsonAtomic } from './files';

export const RunMetaSchema = z.strictObject({
  run: z.string().regex(RUN_ID),
  adapter: z.string().min(1),
  vendor: z.string().min(1),
  role: RoleSchema,
  model: z.string().optional(),
  host: z.string().optional(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).optional(),
  endedBy: EndedBySchema.optional(),
  sessionId: z.string().optional(),
  worktree: z.string().optional(),
  handoffFrom: z.string().optional(),
  cost: CostSchema.optional(),
});
export type RunMeta = z.infer<typeof RunMetaSchema>;

const runNumber = (run: string) => Number(run.slice(1));

/** `runs/<run>-<adapter>-<role>/{meta.json, prompt.md, transcript.jsonl}` of one task. */
export class RunStore {
  constructor(readonly dir: string) {}

  async list(): Promise<RunMeta[]> {
    const metas: RunMeta[] = [];
    for (const name of await this.dirs()) {
      const m = await readJsonIfExists<RunMeta>(join(this.dir, name, 'meta.json'));
      if (m) metas.push(m);
    }
    return metas.sort((a, b) => runNumber(a.run) - runNumber(b.run));
  }

  async nextRunId(): Promise<string> {
    const nums = (await this.dirs()).map((d) => Number(/^r([0-9]+)/.exec(d)?.[1] ?? 0));
    return `r${Math.max(0, ...nums) + 1}`;
  }

  async create(meta: RunMeta): Promise<string> {
    const parsed = RunMetaSchema.parse(meta);
    if (await this.find(parsed.run)) throw new Error(`run ${parsed.run} exists`);
    const path = join(this.dir, `${parsed.run}-${parsed.adapter}-${parsed.role}`);
    await mkdir(path, { recursive: true });
    await writeJsonAtomic(join(path, 'meta.json'), parsed);
    return path;
  }

  async readMeta(run: string): Promise<RunMeta | null> {
    const path = await this.find(run);
    return path ? readJsonIfExists<RunMeta>(join(path, 'meta.json')) : null;
  }

  async updateMeta(run: string, patch: Partial<RunMeta>): Promise<RunMeta> {
    const path = await this.require(run);
    const current = (await readJsonIfExists<RunMeta>(join(path, 'meta.json'))) as RunMeta;
    const next = RunMetaSchema.parse({ ...current, ...patch, run });
    await writeJsonAtomic(join(path, 'meta.json'), next);
    return next;
  }

  async writePrompt(run: string, text: string): Promise<string> {
    const path = join(await this.require(run), 'prompt.md');
    await writeFileAtomic(path, text);
    return path;
  }

  async readPrompt(run: string): Promise<string | null> {
    const path = await this.find(run);
    if (!path) return null;
    try {
      return await readFile(join(path, 'prompt.md'), 'utf8');
    } catch {
      return null;
    }
  }

  /** Appends one line to transcript.jsonl and returns its byte offset: the `raw.pointer` an event keeps. */
  async appendTranscript(run: string, line: string): Promise<{ pointer: string; byteLen: number }> {
    const path = join(await this.require(run), 'transcript.jsonl');
    const offset = await stat(path).then((s) => s.size, () => 0);
    const text = line.endsWith('\n') ? line : `${line}\n`;
    await appendFile(path, text, { flag: 'a' });
    return { pointer: `${run}/transcript.jsonl#${offset}`, byteLen: Buffer.byteLength(text) - 1 };
  }

  async transcriptPath(run: string): Promise<string> {
    return join(await this.require(run), 'transcript.jsonl');
  }

  async find(run: string): Promise<string | null> {
    const name = (await this.dirs()).find((d) => d === run || d.startsWith(`${run}-`));
    return name ? join(this.dir, name) : null;
  }

  private async require(run: string): Promise<string> {
    const path = await this.find(run);
    if (!path) throw new Error(`no run ${run}`);
    return path;
  }

  private async dirs(): Promise<string[]> {
    try {
      return (await readdir(this.dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
  }
}

/** One check of the verify suite (R-029): the tests first, then the task or config checks. */
export const VerificationCheckSchema = z.strictObject({
  name: z.string().min(1),
  kind: z.enum(['test', 'typecheck', 'lint', 'custom']),
  exitCode: z.int(),
  passed: z.int().min(0).optional(),
  failed: z.int().min(0).optional(),
  durationMs: z.int().min(0),
  status: z.enum(['green', 'red']),
});
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

export const VerificationRecordSchema = z.strictObject({
  run: z.string().regex(RUN_ID),
  command: z.string(),
  exitCode: z.int(),
  passed: z.int().min(0),
  failed: z.int().min(0),
  durationMs: z.int().min(0),
  runBy: z.literal('daemon'),
  status: z.enum(['green', 'red']),
  outputRef: z.string(),
  at: z.iso.datetime({ offset: true }),
  timedOut: z.boolean().optional(),
  /** The commit the tests ran on; approve merges only this commit. */
  commit: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  /** Why a record is red when it is not the tests themselves: 'tampered' or 'scenarios' (R-029, R-037). */
  reason: z.string().optional(),
  /** The verify suite this record ran, the tests first (R-029). */
  checks: z.array(VerificationCheckSchema).optional(),
  /** Locked test files that changed, and the `tests:` decision that allowed them when there is one (R-029). Null: none changed. */
  tamper: z.strictObject({ files: z.array(z.string()), allowedBy: z.string().optional() }).nullable().optional(),
  /** Held-out scenarios run in a temporary checkout (R-037). Null: the task has none (or they could not run). */
  scenarios: z.strictObject({ passed: z.int().min(0), failed: z.int().min(0), names: z.array(z.string()) }).nullable().optional(),
  /** Line coverage on the base commit and on the branch, when the runner reports it (R-037). */
  coverage: z.strictObject({ base: z.number().nullable(), branch: z.number().nullable() }).nullable().optional(),
  /** Why there is no coverage, said plainly; the verification does not fail for it. */
  coverageReason: z.string().optional(),
});
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;

/** `verification/<run>.json`: what the daemon saw when it ran the tests itself. */
export class VerificationStore {
  constructor(readonly dir: string) {}

  async write(v: VerificationRecord): Promise<VerificationRecord> {
    const parsed = VerificationRecordSchema.parse(v);
    await writeJsonAtomic(join(this.dir, `${parsed.run}.json`), parsed);
    return parsed;
  }

  async writeOutput(run: string, output: string): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${run}.out.txt`), output);
    return `verification/${run}.out.txt`;
  }

  read(run: string): Promise<VerificationRecord | null> {
    return readJsonIfExists<VerificationRecord>(join(this.dir, `${run}.json`));
  }

  async list(): Promise<VerificationRecord[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.dir)).filter((n) => /^r[0-9]+\.json$/.test(n));
    } catch {
      return [];
    }
    const all = await Promise.all(names.map((n) => readJsonIfExists<VerificationRecord>(join(this.dir, n))));
    return all.filter((v): v is VerificationRecord => v !== null).sort((a, b) => a.at.localeCompare(b.at));
  }

  async latest(): Promise<VerificationRecord | null> {
    return (await this.list()).at(-1) ?? null;
  }
}

/** `handoff.json` (latest) and `handoffs/h<N>.json` (every packet, kept). */
export class HandoffStore {
  constructor(readonly taskDir: string) {}

  async write(h: Handoff, meta?: unknown): Promise<string> {
    const packet = HandoffSchema.parse(h);
    const name = `h${(await this.names()).length + 1}`;
    await writeJsonAtomic(join(this.taskDir, 'handoffs', `${name}.json`), packet);
    if (meta !== undefined) await writeJsonAtomic(join(this.taskDir, 'handoffs', `${name}.meta.json`), meta);
    await writeJsonAtomic(join(this.taskDir, 'handoff.json'), packet);
    return name;
  }

  latest(): Promise<Handoff | null> {
    return readJsonIfExists<Handoff>(join(this.taskDir, 'handoff.json'));
  }

  read(name: string): Promise<Handoff | null> {
    return readJsonIfExists<Handoff>(join(this.taskDir, 'handoffs', `${name}.json`));
  }

  readMeta<T = unknown>(name: string): Promise<T | null> {
    return readJsonIfExists<T>(join(this.taskDir, 'handoffs', `${name}.meta.json`));
  }

  async names(): Promise<string[]> {
    try {
      return (await readdir(join(this.taskDir, 'handoffs')))
        .filter((n) => /^h[0-9]+\.json$/.test(n))
        .map((n) => n.replace('.json', ''))
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    } catch {
      return [];
    }
  }
}
