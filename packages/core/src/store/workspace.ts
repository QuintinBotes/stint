import { type FSWatcher, watch } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type Config, ConfigSchema, DEFAULT_CONFIG } from '../schemas/config';
import { type Plan, PlanSchema } from '../schemas/plan';
import { type Review, ReviewSchema } from '../schemas/review';
import { type Budgets, type Check, type Task, TaskSchema } from '../schemas/task';
import { DecisionLedger } from './decisions';
import { EventLog } from './eventlog';
import { readJsonIfExists, writeJsonAtomic, type AtomicHooks } from './files';
import { HandoffStore, RunStore, VerificationStore } from './runs';

export type StoreErrorCode = 'not_found' | 'exists' | 'no_commits' | 'invalid';

export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type NewTask = {
  id?: string;
  title: string;
  goal: string;
  acceptance: string[];
  testCommand?: string;
  checks?: Check[];
  tags?: string[];
  baseCommit?: string;
  budgets?: Partial<Budgets>;
  links?: Task['links'];
};

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'task';
}

const TASK_DIR = /^(T-[0-9]{4,})(-|$)/;

/** The `.stint/` workspace of one repository. The daemon is its only writer. */
export class Workspace {
  readonly stintDir: string;
  readonly tasksDir: string;
  readonly cacheDir: string;
  readonly worktreesDir: string;

  private constructor(
    readonly root: string,
    readonly config: Config,
  ) {
    this.stintDir = join(root, '.stint');
    this.tasksDir = join(this.stintDir, 'tasks');
    this.cacheDir = join(this.stintDir, 'cache');
    this.worktreesDir = join(this.stintDir, 'worktrees');
  }

  /** Opens `.stint/` under `root`, creating it with the default config.json when missing. */
  static async open(root: string): Promise<Workspace> {
    const stint = join(root, '.stint');
    await mkdir(join(stint, 'tasks'), { recursive: true });
    const configPath = join(stint, 'config.json');
    let raw = await readJsonIfExists<unknown>(configPath);
    if (raw === null) {
      await writeJsonAtomic(configPath, DEFAULT_CONFIG);
      raw = DEFAULT_CONFIG;
    }
    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success) throw new StoreError('invalid', `.stint/config.json is invalid: ${parsed.error.message}`);
    const ws = new Workspace(root, parsed.data);
    await ws.taskDirNames();
    return ws;
  }

  /** `emit: false` skips the task.created event, for the replayer, which appends the recorded one. */
  async createTask(i: NewTask, o: { emit?: boolean } = {}): Promise<Task> {
    const id = i.id ?? (await this.nextTaskId());
    if (await this.findTaskDir(id)) throw new StoreError('exists', `${id} exists`);
    const baseCommit = i.baseCommit ?? headCommit(this.root);
    if (!baseCommit) throw new StoreError('no_commits', 'the repository has no commits; commit once before creating a task');
    const now = new Date().toISOString();
    const parsed = TaskSchema.safeParse({
      version: 'stint.task/1',
      id,
      slug: slugify(i.title),
      title: i.title,
      goal: i.goal,
      acceptance: i.acceptance,
      ...(i.tags ? { tags: i.tags } : {}),
      baseCommit,
      branch: `stint/${id}`,
      status: 'planned',
      assignee: null,
      testCommand: i.testCommand ?? this.config.testCommand,
      ...(i.checks ? { checks: i.checks } : {}),
      budgets: { ...this.config.budgets, ...i.budgets },
      links: i.links ?? { beadsId: null, issueUrl: null },
      pendingAsk: null,
      createdAt: now,
      updatedAt: now,
    });
    if (!parsed.success) throw new StoreError('invalid', parsed.error.message);
    const task = parsed.data;
    const dir = join(this.tasksDir, `${id}-${task.slug}`);
    await mkdir(dir, { recursive: true });
    this.dirCache.set(id, dir);
    await writeJsonAtomic(join(dir, 'task.json'), task);
    if (o.emit === false) return task;
    await this.events(id).append({
      task: id,
      vendor: 'daemon',
      type: 'task.created',
      payload: { title: task.title, goal: task.goal, acceptance: task.acceptance, testCommand: task.testCommand },
    });
    return task;
  }

  async readTask(id: string): Promise<Task> {
    const task = await readJsonIfExists<Task>(join(await this.taskDir(id), 'task.json'));
    if (!task) throw new StoreError('not_found', `${id} has no task.json`);
    return task;
  }

  /** Merges `patch`, validates, writes atomically; a status change also appends `task.status`. */
  async writeTask(id: string, patch: Partial<Task>, hooks?: AtomicHooks, o: { emit?: boolean } = {}): Promise<Task> {
    const current = await this.readTask(id);
    const parsed = TaskSchema.safeParse({
      ...current,
      ...patch,
      id: current.id,
      version: current.version,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
    if (!parsed.success) throw new StoreError('invalid', parsed.error.message);
    await writeJsonAtomic(join(await this.taskDir(id), 'task.json'), parsed.data, hooks);
    if (o.emit !== false && patch.status && patch.status !== current.status) {
      await this.events(id).append({
        task: id,
        vendor: 'daemon',
        type: 'task.status',
        payload: { from: current.status, to: patch.status },
      });
    }
    return parsed.data;
  }

  async listTasks(): Promise<Task[]> {
    const tasks: Task[] = [];
    for (const name of await this.taskDirNames()) {
      const t = await readJsonIfExists<Task>(join(this.tasksDir, name, 'task.json'));
      if (t) tasks.push(t);
    }
    return tasks.sort((a, b) => a.id.localeCompare(b.id));
  }

  async taskDir(id: string): Promise<string> {
    const dir = await this.findTaskDir(id);
    if (!dir) throw new StoreError('not_found', `no task ${id}`);
    return dir;
  }

  events(id: string): EventLog {
    return EventLog.at(join(this.requireCachedDir(id), 'events.jsonl'));
  }

  decisions(id: string): DecisionLedger {
    return new DecisionLedger(join(this.requireCachedDir(id), 'decisions.md'), id);
  }

  runs(id: string): RunStore {
    return new RunStore(join(this.requireCachedDir(id), 'runs'));
  }

  verification(id: string): VerificationStore {
    return new VerificationStore(join(this.requireCachedDir(id), 'verification'));
  }

  handoffs(id: string): HandoffStore {
    return new HandoffStore(this.requireCachedDir(id));
  }

  async readPlan(id: string): Promise<Plan | null> {
    return readJsonIfExists<Plan>(join(await this.taskDir(id), 'plan.json'));
  }

  async writePlan(id: string, plan: Plan): Promise<Plan> {
    const parsed = PlanSchema.parse(plan);
    await writeJsonAtomic(join(await this.taskDir(id), 'plan.json'), parsed);
    return parsed;
  }

  async readReview(id: string): Promise<Review | null> {
    return readJsonIfExists<Review>(join(await this.taskDir(id), 'review.json'));
  }

  /** `review.json` is the latest; `reviews/<run>.json` keeps them all. */
  async writeReview(id: string, review: Review): Promise<Review> {
    const parsed = ReviewSchema.parse(review);
    const dir = await this.taskDir(id);
    await writeJsonAtomic(join(dir, 'reviews', `${parsed.run ?? `x${Date.now()}`}.json`), parsed);
    await writeJsonAtomic(join(dir, 'review.json'), parsed);
    return parsed;
  }

  async readDoc<T>(id: string, name: string): Promise<T | null> {
    return readJsonIfExists<T>(join(await this.taskDir(id), name));
  }

  async writeDoc(id: string, name: string, value: unknown): Promise<void> {
    if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new StoreError('invalid', `bad document name ${name}`);
    await writeJsonAtomic(join(await this.taskDir(id), name), value);
  }

  /** Best-effort change feed for one task (fs.watch, 50 ms debounce); the SSE route also polls. */
  watch(taskId: string, cb: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watcher: FSWatcher | null = null;
    void this.taskDir(taskId).then((dir) => {
      try {
        watcher = watch(dir, { recursive: true }, () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(cb, 50);
        });
      } catch {
        watcher = null;
      }
    }, () => undefined);
    return () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    };
  }

  private dirCache = new Map<string, string>();

  private requireCachedDir(id: string): string {
    const dir = this.dirCache.get(id);
    if (!dir) throw new StoreError('not_found', `no task ${id}`);
    return dir;
  }

  private async findTaskDir(id: string): Promise<string | null> {
    const cached = this.dirCache.get(id);
    if (cached) return cached;
    for (const name of await this.taskDirNames()) {
      const m = TASK_DIR.exec(name);
      if (m?.[1]) this.dirCache.set(m[1], join(this.tasksDir, name));
    }
    return this.dirCache.get(id) ?? null;
  }

  private async taskDirNames(): Promise<string[]> {
    try {
      const entries = await readdir(this.tasksDir, { withFileTypes: true });
      const names = entries.filter((e) => e.isDirectory() && TASK_DIR.test(e.name)).map((e) => e.name);
      for (const n of names) {
        const m = TASK_DIR.exec(n);
        if (m?.[1]) this.dirCache.set(m[1], join(this.tasksDir, n));
      }
      return names;
    } catch {
      return [];
    }
  }

  private async nextTaskId(): Promise<string> {
    const nums = (await this.taskDirNames()).map((n) => Number(TASK_DIR.exec(n)?.[1]?.slice(2) ?? 0));
    return `T-${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`;
  }
}

function headCommit(root: string): string | null {
  const r = Bun.spawnSync(['git', '-C', root, 'rev-parse', '--verify', '-q', 'HEAD'], { stdout: 'pipe', stderr: 'ignore' });
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
}
