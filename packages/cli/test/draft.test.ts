import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Draft } from '@stint-dev/core';
import { startDaemon } from '@stint-dev/daemon';
import { flowConfig, startFakeModels } from '../../../apps/web/e2e/flows/fakes';
import { withFixtureRepo } from '../../daemon/test/helpers';

const stint = (repo: string, args: string[]) => Bun.spawn(['bun', join(import.meta.dir, '..', 'bin', 'stint'), ...args, '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
const out = async (p: ReturnType<typeof stint>) => {
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
};

test('stint draft prints the draft and its questions, answers them from a saved draft, writes spec.md, creates the task, and opens a Spec Kit spec as a goal', async () => {
  const models = startFakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(flowConfig(models.port)));
      const d = await startDaemon({ root: repo, quiet: true, adapters: [] });
      try {
        const printed = await out(stint(repo, ['draft', 'Add a health check endpoint']));
        expect(printed.code, printed.stderr).toBe(0);
        const lines = printed.stdout.split('\n');
        expect(lines[0]).toBe('Task: One agent can build and verify it in one run.');
        expect(lines).toContain('# Feature Specification: Add a health check endpoint');
        expect(lines).toContain('Q1: needs your answer');
        expect(lines).toContain('  A) Only an admin: A person with admin rights changes it. (recommended: It is the smaller change.)');
        expect(printed.stdout).not.toContain('Which file holds the change?');

        const saved = await out(stint(repo, ['draft', 'Add a health check endpoint', '--json']));
        const draftFile = join(repo, 'draft.json');
        writeFileSync(draftFile, saved.stdout);
        expect((JSON.parse(saved.stdout) as Draft).questions.map((q) => q.id)).toEqual(['Q1', 'Q2']);

        const made = await out(stint(repo, ['draft', '--from', draftFile, '--answer', 'Q1=A', '--recommended', '--out', join(repo, 'spec.md'), '--create']));
        expect(made.code, made.stderr).toBe(0);
        expect(made.stdout.trimEnd().split('\n').slice(-2)).toEqual([`Wrote ${join(repo, 'spec.md')}.`, 'Created T-0001.']);
        expect(readFileSync(join(repo, 'spec.md'), 'utf8').split('\n')[0]).toBe('# Feature Specification: Add a health check endpoint');
        expect((await d.ws.decisions('T-0001').validAt()).map((x) => x.text)).toEqual([
          'Who may turn the new behaviour off once it ships? Answer: Only an admin',
          'Should the change write a log line each time it runs? Answer: One line per run',
        ]);

        const wrong = await out(stint(repo, ['draft', '--from', draftFile, '--answer', 'Q9=A']));
        expect(wrong.code).toBe(2);
        expect(wrong.stderr).toBe('"Q9=A" names no question of this draft. Write it as Q1=A, or Q1=your own words; the questions are Q1, Q2.\n');

        const goal = await out(stint(repo, ['draft', '--from', join(repo, 'spec.md'), '--tasks', join(import.meta.dir, '..', '..', 'core', 'test', 'fixtures', 'speckit', 'tasks-template.md'), '--create', '--json']));
        expect(goal.code, goal.stderr).toBe(0);
        expect(JSON.parse(goal.stdout)).toEqual({ kind: 'goal', id: 'G-0001' });
        expect((await d.ws.readGoal('G-0001')).criteria.map((c) => c.text)).toEqual(['Both stories pass their scenarios.']);
      } finally {
        await d.stop();
      }
    });
  } finally {
    models.stop();
  }
}, 60_000);
