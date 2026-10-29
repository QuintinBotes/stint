import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { startDaemon } from '@stint-dev/daemon';
import { tempDir, withFixtureRepo } from '../../daemon/test/helpers';

const CLI = join(import.meta.dir, '..', 'bin', 'stint');
const tmp = tempDir('stint-intake-');
const bin = join(tmp.dir, 'bin');
const path = process.env.PATH;

/** A triage model: an issue about rate limits is a duplicate of the first similar task it is shown. */
const model = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
    const prompt = ((await req.json()) as { messages: Array<{ content: string }> }).messages.map((m) => m.content).join('\n');
    const issue = /Title: (.+)/.exec(prompt)?.[1] ?? '';
    const shown = /## Existing tasks with similar words\n- (T-\d+)/.exec(prompt)?.[1];
    const dup = /rate.limit/i.test(issue) && shown ? [shown, 'T-9999'] : [];
    const answer = { size: dup.length ? 'S' : 'M', title: issue.slice(0, 100), goal: `Done when ${issue.toLowerCase()}.`, acceptance: [`${issue} works`], duplicates: dup, risk: 'low', reason: dup.length ? `Already covered by ${shown}.` : 'New work.' };
    return Response.json({ message: { content: JSON.stringify(answer) }, prompt_eval_count: 50, eval_count: 20 });
  },
});

beforeAll(() => {
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\nif [ "$1" = "issue" ]; then cat <<'JSON'\n[{"number":41,"title":"Rate-limit incoming webhooks","body":"Tenants flood us.","url":"https://example.invalid/acme/api/issues/41","labels":[{"name":"limits"}]},{"number":42,"title":"Export audit log as CSV","body":"Ops wants a CSV.","url":"https://example.invalid/acme/api/issues/42","labels":[]}]\nJSON\nexit 0; fi\necho "fake gh: $@" >&2; exit 1\n`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  process.env.PATH = `${bin}:${path}`;
});
afterAll(() => {
  process.env.PATH = path;
  model.stop(true);
  tmp.cleanup();
});

function config(repo: string, extra?: (c: Config) => void) {
  const c = structuredClone(DEFAULT_CONFIG);
  c.hosts.ollama = { ...(c.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: `http://127.0.0.1:${model.port}/v1`, models: { fake: 'fake' } };
  c.routes.planner = ['ollama/fake'];
  extra?.(c);
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(c));
}

// async, not spawnSync: the daemon answering the CLI runs in this same process
const stint = async (repo: string, ...args: string[]) => {
  const p = Bun.spawn(['bun', CLI, ...args, '--repo', repo], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
};

test('A fake gh returning two issues creates two intake items, triage marks one as a duplicate of an existing task, Accept creates a task with source.kind: github', async () => {
  await withFixtureRepo(async (repo) => {
    config(repo);
    const d = await startDaemon({ root: repo, quiet: true, adapters: [] });
    try {
      const existing = await d.ws.createTask({ title: 'Rate-limit incoming webhooks per tenant', goal: 'Answer 429 when a tenant is over the limit.', acceptance: ['429'] });
      const pulled = await stint(repo, 'intake', 'github');
      expect(pulled.code).toBe(0);
      expect(pulled.out).toContain('2 new in the intake queue (2 triaged)');

      const get = async <T>(p: string) => (await (await fetch(`${d.url}${p}`)).json()) as T;
      const post = (p: string, body: unknown) => fetch(`${d.url}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const items = await get<Array<{ id: string; state: string; triage: { duplicates: string[]; size: string } | null }>>('/api/intake');
      expect(items.map((i) => i.id).sort()).toEqual(['github-41', 'github-42']);
      // the model named a task it was not shown as well; only the one it was shown survives
      expect(items.find((i) => i.id === 'github-41')?.triage).toMatchObject({ duplicates: [existing.id], size: 'S' });
      expect(items.find((i) => i.id === 'github-42')?.triage?.duplicates).toEqual([]);
      // an item is not a task yet, so each triage's cost is in the workspace log
      const spent = (await d.ws.workspaceEvents().read()).filter((e) => e.type === 'cost.recorded');
      expect(spent.map((e) => [e.payload.for, e.payload.item, e.payload.host, (e.payload.cost as { inputTokens: number }).inputTokens]).sort()).toEqual([
        ['triage', 'github-41', 'ollama', 50],
        ['triage', 'github-42', 'ollama', 50],
      ]);
      // R-041 Req 1 and 2: the pull itself records each item's arrival and its triage, in the workspace log
      const arrived = (await d.ws.workspaceEvents().read()).filter((e) => e.type.startsWith('intake.'));
      expect(arrived.map((e) => [e.type, e.payload.item, e.payload.ref ?? (e.payload.triage as { size: string }).size])).toEqual([
        ['intake.received', 'github-41', '41'],
        ['intake.triaged', 'github-41', 'S'],
        ['intake.received', 'github-42', '42'],
        ['intake.triaged', 'github-42', 'M'],
      ]);

      const accepted = (await (await post('/api/intake/github-42/accept', {})).json()) as { task: string };
      const task = await d.ws.readTask(accepted.task);
      expect(task).toMatchObject({ title: 'Export audit log as CSV', source: { kind: 'github', ref: '42', url: 'https://example.invalid/acme/api/issues/42' }, tags: ['intake'] });
      const events = await d.ws.events(accepted.task).read();
      expect(events.filter((e) => e.type.startsWith('intake.')).map((e) => e.type)).toEqual(['intake.received', 'intake.triaged']);

      // the duplicate goes onto the task it duplicates, and nothing new is made
      expect((await post('/api/intake/github-41/merge', { task: existing.id })).status).toBe(200);
      expect((await d.ws.events(existing.id).read()).find((e) => e.type === 'intake.received')?.payload).toMatchObject({ ref: '41', mergedInto: existing.id });
      expect((await d.ws.readTask(existing.id)).links.issueUrl).toBe('https://example.invalid/acme/api/issues/41');
      expect((await d.ws.listTasks()).length).toBe(2);

      // an issue is never pulled twice, accepted, merged or not
      expect((await stint(repo, 'intake', 'github')).out).toContain('Nothing new.');
      expect((await post('/api/intake/github-41/accept', {})).status).toBe(400);
    } finally {
      await d.stop();
    }
  });
}, 60_000);

test('Linear issues come through GraphQL with the key from the named variable, and a triage nobody answers stays open without one', async () => {
  let auth = '';
  const linear = Bun.serve({
    port: 0,
    async fetch(req) {
      auth = req.headers.get('authorization') ?? '';
      return Response.json({ data: { issues: { nodes: [{ identifier: 'ENG-7', title: 'Paginate the tenants list', description: 'It is slow.', url: 'https://example.invalid/ENG-7', labels: { nodes: [{ name: 'perf' }] } }] } } });
    },
  });
  process.env.STINT_LINEAR_URL = `http://127.0.0.1:${linear.port}/graphql`;
  process.env.STINT_TEST_LINEAR_KEY = 'lin_api_test';
  try {
    await withFixtureRepo(async (repo) => {
      config(repo, (c) => {
        c.intake = { linear: { team: 'ENG', keyEnv: 'STINT_TEST_LINEAR_KEY' } };
        c.routes.planner = ['meta-api/muse-spark-1.3'];
        c.hosts['meta-api'] = { ...(c.hosts['meta-api'] as NonNullable<Config['hosts']['meta-api']>), baseURL: 'http://127.0.0.1:9/v1' };
      });
      const d = await startDaemon({ root: repo, quiet: true, adapters: [] });
      try {
        const r = await stint(repo, 'intake', 'linear');
        expect(r.out).toContain('1 new in the intake queue (0 triaged): linear-ENG-7');
        expect(auth).toBe('lin_api_test');
        const items = (await (await fetch(`${d.url}/api/intake`)).json()) as Array<{ id: string; triage: unknown; triageError?: string; labels: string[] }>;
        expect(items[0]).toMatchObject({ id: 'linear-ENG-7', triage: null, labels: ['perf'] });
        expect(items[0]?.triageError).toBeTruthy();
        // a triage nobody answered is still recorded, with no triage and the reason
        const arrived = (await d.ws.workspaceEvents().read()).filter((e) => e.type.startsWith('intake.'));
        expect(arrived.map((e) => [e.type, e.payload.item, e.payload.triage ?? null, typeof e.payload.error])).toEqual([
          ['intake.received', 'linear-ENG-7', null, 'undefined'],
          ['intake.triaged', 'linear-ENG-7', null, 'string'],
        ]);
      } finally {
        await d.stop();
      }
    });
  } finally {
    linear.stop(true);
    delete process.env.STINT_LINEAR_URL;
    delete process.env.STINT_TEST_LINEAR_KEY;
  }
}, 60_000);
