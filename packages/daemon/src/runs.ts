import type { PermissionOption } from '@stint-dev/core';

/** A permission question waiting for a person, held on its live run (R-033). */
export type PendingPermission = {
  requestId: string;
  tool: string;
  title: string;
  options: PermissionOption[];
  resolve: (answer: { optionId: string } | 'cancelled') => void;
};

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
  /** Permission questions this run is waiting on, by request id (R-033). */
  permissions?: Map<string, PendingPermission>;
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

  /** Every pending permission across live runs, for the queue (R-033). */
  pendingPermissions(): Array<{ task: string; run: string; requestId: string; tool: string; title: string; options: PermissionOption[] }> {
    const out: Array<{ task: string; run: string; requestId: string; tool: string; title: string; options: PermissionOption[] }> = [];
    for (const r of this.byTask.values()) {
      for (const p of r.permissions?.values() ?? []) out.push({ task: r.task, run: r.run, requestId: p.requestId, tool: p.tool, title: p.title, options: p.options });
    }
    return out;
  }
}
