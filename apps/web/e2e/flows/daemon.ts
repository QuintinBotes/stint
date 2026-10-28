// What the flow tests ask the daemon directly, to prove its state matches the screen.
import { type APIRequestContext, expect } from '@playwright/test';

type Event = { type: string; run?: string; adapter?: string; ts: string; payload: Record<string, unknown> };
type Task = { id: string; title: string; status: string; acceptance: string[]; branch: string; dependsOn?: string[] };

export function daemon(request: APIRequestContext) {
  let token: string | null = null;
  const auth = async () => {
    token ??= /name="stint-token" content="([^"]+)"/.exec(await (await request.get('/')).text())?.[1] ?? '';
    return { Authorization: `Bearer ${token}` };
  };
  const self = {
    async get<T>(path: string): Promise<T> {
      const res = await request.get(path);
      expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
      return (await res.json()) as T;
    },
    async post<T>(path: string, data: unknown = {}): Promise<T> {
      const res = await request.post(path, { data, headers: await auth() });
      expect(res.ok(), `${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
      return (await res.json()) as T;
    },
    async patch<T>(path: string, data: unknown): Promise<T> {
      const res = await request.patch(path, { data, headers: await auth() });
      expect(res.ok(), `${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
      return (await res.json()) as T;
    },
    task: (id: string) => self.get<Task>(`/api/tasks/${id}`).then((b) => (b as unknown as { task: Task }).task),
    events: (id: string) => self.get<{ events: Event[] }>(`/api/tasks/${id}/events`).then((r) => r.events),
    /** A task made through the API, for flows that do not test making one. */
    create: (title: string, acceptance = ['the task file exists']) => self.post<Task>('/api/tasks', { title, goal: `${title}, as a flow test.`, acceptance }),
    /** Waits until a task's log has what `done` looks for. */
    async until(id: string, done: (events: Event[]) => boolean, ms = 60_000): Promise<Event[]> {
      let events: Event[] = [];
      await expect.poll(async () => done((events = await self.events(id))), { timeout: ms, intervals: [100, 250, 500] }).toBe(true);
      return events;
    },
  };
  return self;
}

export const stopped = (events: Event[]) => events.some((e) => e.type === 'autopilot.stopped');
