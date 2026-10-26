import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { project, skillsHelped } from '@stint-dev/core/node';
import { gitOk, startDaemon } from '../src/index';
import { makeApp, newTask, post, tempDir, withFixtureRepo } from './helpers';

/** A fake `gh` on PATH: `run list` answers from a state file, everything else from `pr-view.json`. */
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

test('A fixture repo where a Stint-Task merge is reverted yields exactly one outcome.reverted after two scans', async () => {
  await withFixtureRepo(async (repo) => {
    await withFakeGh(async () => {
      const { app, ws } = await makeApp(repo);
      const task = await ws.createTask(newTask);
      const base = (await gitOk(repo, ['symbolic-ref', '-q', '--short', 'HEAD'])).trim();
      // a real merge of the task branch, carrying the Stint-Task trailer
      await gitOk(repo, ['checkout', '-q', '-b', task.branch]);
      writeFileSync(join(repo, 'src/lib/outcome-fixture.ts'), 'export const OUTCOME = 1;\n');
      await gitOk(repo, ['add', '--', 'src/lib/outcome-fixture.ts']);
      await gitOk(repo, ['commit', '-q', '-m', 'Add the outcome fixture']);
      await gitOk(repo, ['checkout', '-q', base]);
      // a learned skill on probation, mounted on this task
      mkdirSync(join(repo, '.agents/skills/limiter-config-via-env'), { recursive: true });
      writeFileSync(join(repo, '.agents/skills/limiter-config-via-env/SKILL.md'), '---\nname: limiter-config-via-env\ndescription: Read limits through loadConfig.\norigin: learn-loop\nstatus: probation\n---\nRead limits through loadConfig().\n');
      await gitOk(repo, ['add', '--', '.agents/skills']);
      await gitOk(repo, ['commit', '-q', '-m', 'Add a probation skill']);
      await gitOk(repo, ['merge', '-q', '--no-ff', task.branch, '-m', `${task.title} (${task.id})`, '-m', `Stint-Task: ${task.id}`]);
      const mergeCommit = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
      const events = ws.events(task.id);
      await events.append({ task: task.id, run: 'r1', vendor: 'daemon', type: 'skill.applied', payload: { skill: 'limiter-config-via-env', run: 'r1' } });
      await events.append({ task: task.id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/lib/outcome-fixture.ts', added: 1, removed: 0 } });
      await events.append({ task: task.id, vendor: 'daemon', type: 'merge.completed', payload: { branch: task.branch, into: base, commit: mergeCommit, trailers: { 'Stint-Task': task.id } } });

      await gitOk(repo, ['revert', '-m', '1', '--no-edit', mergeCommit]);
      const revertCommit = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
      expect(await gitOk(repo, ['log', '-1', '--format=%B'])).toContain(`This reverts commit ${mergeCommit}`);

      for (let i = 0; i < 2; i++) {
        const res = await post(app, '/api/outcomes/scan', {});
        expect(res.status).toBe(200);
      }
      const reverted = (await events.read()).filter((e) => e.type === 'outcome.reverted');
      expect(reverted).toHaveLength(1);
      expect(reverted[0]?.payload).toMatchObject({ task: task.id, commit: revertCommit, mergeCommit });

      // the outcome is exposed on the task bundle and hangs from the merge in the graph
      const bundle = (await (await app.request(`/api/tasks/${task.id}`)).json()) as { outcomes: Array<{ kind: string; commit: string | null }> };
      expect(bundle.outcomes.map((o) => o.kind)).toEqual(['reverted']);
      expect(bundle.outcomes[0]?.commit).toBe(revertCommit);
      const graph = await project(ws);
      const edge = graph.edges.find((e) => e.type === 'resulted_in' && e.data.outcome === 'reverted');
      expect(edge?.from).toBe(`merge:${mergeCommit}`);
      expect(edge?.to).toBe('outcome:reverted');
      // a reverted task with a skill mounted counts as hurt
      const helped = await skillsHelped(ws);
      expect(helped.find((r) => r.skill === 'limiter-config-via-env')?.hurt).toBe(1);
      // and the scan itself moves the skill's track record: hurt and never helped, so retirement is proposed, once
      const proposed = (await events.read()).filter((e) => e.type === 'skill.retire_proposed');
      expect(proposed).toHaveLength(1);
      expect(proposed[0]?.payload).toMatchObject({ id: 'limiter-config-via-env', hurt: 1, helped: 0 });
    });
  });
}, 60_000);

test('MUST scan git on daemon start: a revert recorded before start yields outcome.reverted without a scan call', async () => {
  await withFixtureRepo(async (repo) => {
    await withFakeGh(async () => {
      const { ws } = await makeApp(repo);
      const task = await ws.createTask(newTask);
      const base = (await gitOk(repo, ['symbolic-ref', '-q', '--short', 'HEAD'])).trim();
      writeFileSync(join(repo, 'src/lib/start-scan.ts'), 'export const START_SCAN = 1;\n');
      await gitOk(repo, ['add', '--', 'src/lib/start-scan.ts']);
      await gitOk(repo, ['commit', '-q', '-m', `${task.title} (${task.id})`, '-m', `Stint-Task: ${task.id}`]);
      const commit = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
      await ws.events(task.id).append({ task: task.id, vendor: 'daemon', type: 'merge.completed', payload: { branch: task.branch, into: base, commit, trailers: { 'Stint-Task': task.id } } });
      await gitOk(repo, ['revert', '--no-edit', commit]);
      const daemon = await startDaemon({ root: repo, adapters: [], quiet: true, webDist: null });
      try {
        const reverted = (await ws.events(task.id).read()).filter((e) => e.type === 'outcome.reverted');
        expect(reverted).toHaveLength(1);
      } finally {
        await daemon.stop();
      }
    });
  });
}, 60_000);

test("A second task touching the first's files within 7 days yields outcome.followup; one after 8 days does not", async () => {
  await withFixtureRepo(async (repo) => {
    await withFakeGh(async () => {
      const { app, ws } = await makeApp(repo);
      const base = (await gitOk(repo, ['symbolic-ref', '-q', '--short', 'HEAD'])).trim();
      const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
      const first = await ws.createTask(newTask);
      await ws.events(first.id).append({ task: first.id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/lib/limiter.ts', added: 4, removed: 1 } });
      await ws.events(first.id).append({ task: first.id, vendor: 'daemon', type: 'merge.completed', payload: { branch: first.branch, into: base, commit: head, trailers: { 'Stint-Task': first.id } } });

      const soon = await ws.createTask({ ...newTask, title: 'Follow up on the limiter' });
      await ws.events(soon.id).append({ task: soon.id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/lib/limiter.ts', added: 2, removed: 0 } });

      const late = await ws.createTask({ ...newTask, title: 'Much later limiter work' });
      await ws.events(late.id).append({ task: late.id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/lib/limiter.ts', added: 1, removed: 0 } });
      // the late task was created 8 days after the merge
      const latePath = join(await ws.taskDir(late.id), 'task.json');
      const lateTask = JSON.parse(readFileSync(latePath, 'utf8')) as { createdAt: string };
      lateTask.createdAt = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(latePath, `${JSON.stringify(lateTask, null, 2)}\n`);

      for (let i = 0; i < 2; i++) expect((await post(app, '/api/outcomes/scan', {})).status).toBe(200);
      const followups = (await ws.events(first.id).read()).filter((e) => e.type === 'outcome.followup');
      expect(followups).toHaveLength(1);
      expect(followups[0]?.payload).toMatchObject({ task: first.id, followup: soon.id, files: ['src/lib/limiter.ts'] });
    });
  });
}, 60_000);
