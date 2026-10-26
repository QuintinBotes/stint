/** Live runs in this daemon. `run_active` is enforced from here: one live run per task. */
export type ActiveRun = {
  task: string;
  run: string;
  adapter: string;
  worktree: string;
  startedAt: string;
  abort: AbortController;
  /** The process group of the agent, when the adapter spawned one (the kill beat). */
  pgid?: number;
  /** The last tool call with no result yet: the in-flight step if the run is killed. */
  inFlight?: string | null;
  done: Promise<unknown>;
};

export class RunRegistry {
  private byTask = new Map<string, ActiveRun>();

  get(task: string): ActiveRun | undefined {
    return this.byTask.get(task);
  }

  add(r: ActiveRun): void {
    this.byTask.set(r.task, r);
  }

  remove(task: string, run: string): void {
    if (this.byTask.get(task)?.run === run) this.byTask.delete(task);
  }

  holds(worktree: string): boolean {
    return [...this.byTask.values()].some((r) => r.worktree === worktree);
  }

  list(): ActiveRun[] {
    return [...this.byTask.values()];
  }
}
