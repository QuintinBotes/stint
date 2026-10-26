import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitOk } from '../src/index';
import { builtTask, makeApp, newTask, post, tempDir, withFixtureRepo } from './helpers';

/** A fake `gh` on PATH, steered by files in its state dir: `runs.json` and `pr-view.json`. */
function installFakeGh(dir: string): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(dir, 'runs.json'), '[]');
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/bin/sh',
      `state="${dir}"`,
      'if [ "$1" = "run" ]; then cat "$state/runs.json"; exit 0; fi',
      'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then printf "%s\n" "$@" > "$state/pr-create.args"; echo "https://example.invalid/acme/widgets/pull/7"; exit 0; fi',
      'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then cat "$state/pr-view.json"; exit 0; fi',
      'echo "fake gh: unexpected $@" >&2; exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'gh'), 0o755);
  return bin;
}

async function withFakeGh<T>(fn: (state: string) => Promise<T>): Promise<T> {
  const tmp = tempDir('stint-fake-gh-');
  const path = process.env.PATH;
  try {
    process.env.PATH = `${installFakeGh(tmp.dir)}:${path ?? ''}`;
    return await fn(tmp.dir);
  } finally {
    process.env.PATH = path;
    tmp.cleanup();
  }
}

test('With a fake gh, approve in PR mode records release.pr_opened, failing checks return the task to Needs you, and a merged PR completes it', async () => {
  await withFixtureRepo(async (repo) => {
    await withFakeGh(async (state) => {
      const remote = tempDir('stint-bare-remote-');
      try {
        await gitOk(remote.dir, ['init', '--bare', '-q', 'remote.git']);
        const bare = join(remote.dir, 'remote.git');
        const { app, ws, t } = await builtTask(repo);
        const base = (await gitOk(repo, ['symbolic-ref', '-q', '--short', 'HEAD'])).trim();
        await gitOk(repo, ['remote', 'set-url', 'origin', bare]);
        (ws.config as { release?: unknown }).release = { mode: 'pr', remote: 'origin', base };

        const res = await post(app, `/api/tasks/${t.id}/approve`, {});
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string; url: string; number: number };
        expect(body).toMatchObject({ status: 'in_review', number: 7, url: 'https://example.invalid/acme/widgets/pull/7' });
        expect((await ws.readTask(t.id)).status).toBe('in_review');
        const opened = (await ws.events(t.id).read()).filter((e) => e.type === 'release.pr_opened');
        expect(opened).toHaveLength(1);
        expect(opened[0]?.payload).toMatchObject({ url: body.url, number: 7 });
        // the pull request was opened from the task branch with the trailers in its body
        const createArgs = readFileSync(join(state, 'pr-create.args'), 'utf8');
        expect(createArgs).toContain(`stint/${t.id}`);
        expect(createArgs).toContain(`Stint-Task: ${t.id}`);
        // and the branch was really pushed to the bare remote
        const pushed = (await gitOk(repo, ['--git-dir', bare, 'rev-parse', `refs/heads/stint/${t.id}`])).trim();
        expect(pushed).toMatch(/^[0-9a-f]{40}$/);

        writeFileSync(
          join(state, 'pr-view.json'),
          JSON.stringify({ state: 'OPEN', mergeCommit: null, statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
        );
        const failed = await post(app, `/api/tasks/${t.id}/release/refresh`, {});
        expect(failed.status).toBe(200);
        expect(((await failed.json()) as { status: string }).status).toBe('awaiting_approval');
        const waiting = await ws.readTask(t.id);
        expect(waiting.status).toBe('awaiting_approval');
        expect(waiting.pendingAsk).toContain('test');
        const checks = (await ws.events(t.id).read()).filter((e) => e.type === 'release.checks');
        expect(checks.at(-1)?.payload).toMatchObject({ name: 'test', status: 'failure' });

        writeFileSync(
          join(state, 'pr-view.json'),
          JSON.stringify({ state: 'MERGED', mergeCommit: { oid: pushed }, statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }),
        );
        const merged = await post(app, `/api/tasks/${t.id}/release/refresh`, {});
        expect(merged.status).toBe(200);
        expect(((await merged.json()) as { status: string }).status).toBe('done');
        expect((await ws.readTask(t.id)).status).toBe('done');
        const merges = (await ws.events(t.id).read()).filter((e) => e.type === 'merge.completed');
        expect(merges).toHaveLength(1);
        expect(merges[0]?.payload.commit).toBe(pushed);
      } finally {
        remote.cleanup();
      }
    });
  });
}, 120_000);

test('POST /api/outcomes with a merge commit records the incident on the right task', async () => {
  await withFixtureRepo(async (repo) => {
    await withFakeGh(async (state) => {
      const { app, ws } = await makeApp(repo);
      const task = await ws.createTask(newTask);
      const other = await ws.createTask({ ...newTask, title: 'An unrelated task' });
      const base = (await gitOk(repo, ['symbolic-ref', '-q', '--short', 'HEAD'])).trim();
      writeFileSync(join(repo, 'src/lib/incident-fixture.ts'), 'export const INCIDENT = 1;\n');
      await gitOk(repo, ['add', '--', 'src/lib/incident-fixture.ts']);
      await gitOk(repo, ['commit', '-q', '-m', `${task.title} (${task.id})`, '-m', `Stint-Task: ${task.id}`]);
      const commit = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
      await ws.events(task.id).append({ task: task.id, vendor: 'daemon', type: 'merge.completed', payload: { branch: task.branch, into: base, commit, trailers: { 'Stint-Task': task.id } } });

      // no token, no write
      const denied = await app.request('/api/outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit, kind: 'incident', summary: 'Webhooks returned 500 for one tenant.' }),
      });
      expect(denied.status).toBe(401);

      // a commit id is hex or it is refused: it reaches git as an argument
      expect((await post(app, '/api/outcomes', { commit: '--output=/tmp/x', kind: 'incident', summary: 'x' })).status).toBe(400);
      const res = await post(app, '/api/outcomes', { commit, kind: 'incident', summary: 'Webhooks returned 500 for one tenant.', url: 'https://example.invalid/incidents/9' });
      expect(res.status).toBe(201);
      const incidents = (await ws.events(task.id).read()).filter((e) => e.type === 'outcome.incident');
      expect(incidents).toHaveLength(1);
      expect(incidents[0]?.payload).toMatchObject({ task: task.id, kind: 'incident', summary: 'Webhooks returned 500 for one tenant.', commit });
      expect((await ws.events(other.id).read()).filter((e) => e.type === 'outcome.incident')).toHaveLength(0);
      const bundle = (await (await app.request(`/api/tasks/${task.id}`)).json()) as { outcomes: Array<{ kind: string }> };
      expect(bundle.outcomes.map((o) => o.kind)).toEqual(['incident']);

      // a failed CI run on the same trailer commit is recorded once per run id, and only once a release is set up
      writeFileSync(
        join(state, 'runs.json'),
        JSON.stringify([{ headSha: commit, conclusion: 'failure', databaseId: 4242, url: 'https://example.invalid/runs/4242', name: 'ci' }]),
      );
      expect((await (await post(app, '/api/outcomes/scan', {})).json()) as { ci: number }).toMatchObject({ ci: 0 });
      expect((await ws.events(task.id).read()).some((e) => e.type === 'outcome.ci')).toBe(false);
      ws.config.release = { mode: 'merge', remote: 'origin' };
      for (let i = 0; i < 2; i++) expect((await post(app, '/api/outcomes/scan', {})).status).toBe(200);
      const ci = (await ws.events(task.id).read()).filter((e) => e.type === 'outcome.ci');
      expect(ci).toHaveLength(1);
      expect(ci[0]?.payload).toMatchObject({ task: task.id, run: 4242, status: 'failure', commit });
    });
  });
}, 60_000);
