import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SharpenState } from '@stint-dev/core';
import { startDaemon } from '@stint-dev/daemon';
import { flowConfig, startFakeModels } from '../../../apps/web/e2e/flows/fakes';
import { withFixtureRepo } from '../../daemon/test/helpers';
import { repeated } from '../src/goal';

const stint = (repo: string, args: string[], input?: string) =>
  Bun.spawn(['bun', join(import.meta.dir, '..', 'bin', 'stint'), ...args, '--repo', repo], { stdout: 'pipe', stderr: 'pipe', ...(input !== undefined ? { stdin: new Response(input) } : {}) });
const out = async (p: ReturnType<typeof stint>) => {
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
};

test('stint goal new, sharpen, plan, show and list: a goal is made, sharpened, split into tasks only when asked, and shown rolled up', async () => {
  const models = startFakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(flowConfig(models.port)));
      const d = await startDaemon({ root: repo, quiet: true, adapters: [] });
      try {
        expect((await out(stint(repo, ['goal', 'list']))).stdout).toContain('No goals yet. Make one with: stint goal new');
        const none = await out(stint(repo, ['goal', 'new', 'Health checks', '--outcome', 'Operators can tell the service is up.']));
        expect(none.code).toBe(2);
        expect(none.stderr).toContain('at least one --criterion');

        const made = await out(stint(repo, ['goal', 'new', 'Health checks', '--outcome', 'Operators can tell the service is up.', '--criterion', 'GET /health answers 200', '--criterion', 'The body says ok', '--non-goal', 'Metrics', '--max-usd', '4', '--max-builds', '4']));
        expect(made.code, made.stderr).toBe(0);
        expect(made.stdout).toBe('G-0001\n');
        expect(await d.ws.readGoal('G-0001')).toMatchObject({ title: 'Health checks', criteria: [{ text: 'GET /health answers 200' }, { text: 'The body says ok' }], nonGoals: ['Metrics'], limits: { usd: 4, builds: 4 }, status: 'draft' });

        const round = await out(stint(repo, ['goal', 'sharpen', 'G-0001', '--recommended', '--json']));
        expect(round.code, round.stderr).toBe(0);
        const st = JSON.parse(round.stdout) as SharpenState;
        expect(st.questions.map((q) => [q.id, q.material, q.answered?.by ?? null])).toEqual([
          ['Q1', true, null],
          ['Q2', false, 'you'],
        ]);
        const answered = await out(stint(repo, ['answer', 'G-0001', 'Q1', 'a']));
        expect(answered.stdout).toBe('Q1: Only an admin. Recorded as D2.\n');
        expect((await d.ws.readGoal('G-0001')).decisions.map((x) => x.id)).toEqual(['D1', 'D2']);

        // asked, and answered no: the proposal is shown and nothing is created
        const declined = await out(stint(repo, ['goal', 'plan', 'G-0001'], 'n\n'));
        expect(declined.code, declined.stderr).toBe(0);
        expect(declined.stdout).toContain('G-0001: 2 proposed tasks\n  1. Part 1: GET /health answers 200 (covers 1)\n');
        expect(declined.stdout).toContain('  2. Part 2: The body says ok (covers 2; after 1)\n');
        expect(declined.stdout).toContain('Create these 2 tasks? [y/N] Nothing was created.');
        expect(await d.ws.listTasks()).toEqual([]);

        const planned = await out(stint(repo, ['goal', 'plan', 'G-0001', '--yes']));
        expect(planned.code, planned.stderr).toBe(0);
        expect(planned.stdout).toContain('Created T-0001, T-0002.');
        const [a, b] = await d.ws.listTasks();
        expect(a).toMatchObject({ goalId: 'G-0001', goalCriteria: [1], limits: { usd: 2, builds: 2 } });
        expect(b).toMatchObject({ goalId: 'G-0001', goalCriteria: [2], dependsOn: ['T-0001'] });
        expect((await d.ws.decisions('T-0002').read()).map((x) => x.by)).toEqual(['goal', 'goal']);

        const shown = await out(stint(repo, ['goal', 'show', 'G-0001']));
        expect(shown.code, shown.stderr).toBe(0);
        expect(shown.stdout).toBe(
          [
            'G-0001: Health checks (running), 0 of 2 criteria met',
            '  1. Not checked: GET /health answers 200',
            '     T-0001: Stint has not run the tests yet.',
            '  2. Not checked: The body says ok',
            '     T-0002: Stint has not run the tests yet.',
            'Tasks: 2, 0 merged',
            '  T-0001 In progress: Part 1: GET /health answers 200 (covers 1)',
            '  T-0002 In progress: Part 2: The body says ok (covers 2)',
            'Spend: $0.00 of $4.00',
            'Builds: 0 of 4',
            'Result: in progress',
            '',
          ].join('\n'),
        );
        const json = JSON.parse((await out(stint(repo, ['goal', 'show', 'G-0001', '--json']))).stdout) as { goal: { id: string }; outcome: { met: number; tasks: unknown[] } };
        expect(json).toMatchObject({ goal: { id: 'G-0001' }, outcome: { met: 0 } });
        expect(json.outcome.tasks).toHaveLength(2);
        expect((await out(stint(repo, ['goal', 'list']))).stdout).toBe('G-0001  running  0 of 2 criteria met  2 tasks  $0.00 of $4.00  Health checks\n');
      } finally {
        await d.stop();
      }
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('A flag given more than once keeps every value, in order, with or without =', () => {
  expect(repeated(['G', '--criterion', 'one', '--x', 'y', '--criterion=two', '--criterion', ' '], 'criterion')).toEqual(['one', 'two']);
  expect(repeated(['--criterion'], 'criterion')).toEqual([]);
});
