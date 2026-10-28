import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SharpenState } from '@stint-dev/core';
import { startDaemon } from '@stint-dev/daemon';
import { flowConfig, startFakeModels } from '../../../apps/web/e2e/flows/fakes';
import { withFixtureRepo } from '../../daemon/test/helpers';
import { parseProof } from '../src/sharpen';

const stint = (repo: string, args: string[], input?: string) =>
  Bun.spawn(['bun', join(import.meta.dir, '..', 'bin', 'stint'), ...args, '--repo', repo], { stdout: 'pipe', stderr: 'pipe', ...(input !== undefined ? { stdin: new Response(input) } : {}) });
const out = async (p: ReturnType<typeof stint>) => {
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
};

test('stint sharpen --recommended --json prints the round; stint answer, interactive stint sharpen and stint proofs record decisions and proofs', async () => {
  const models = startFakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(flowConfig(models.port)));
      const d = await startDaemon({ root: repo, quiet: true, adapters: [] });
      try {
        const t = await d.ws.createTask({ title: 'Add a health endpoint', goal: 'GET /health answers 200.', acceptance: ['GET /health answers 200', 'The body says ok'], testCommand: 'true' });

        const round = await out(stint(repo, ['sharpen', t.id, '--recommended', '--json']));
        expect(round.code, round.stderr).toBe(0);
        const st = JSON.parse(round.stdout) as SharpenState;
        expect(st.round).toBe(1);
        expect(st.questions.map((q) => [q.id, q.material, q.answered?.by ?? null])).toEqual([
          ['Q1', true, null],
          ['Q2', false, 'you'],
        ]);
        expect(st.open).toEqual(['Q1']);

        const answered = await out(stint(repo, ['answer', t.id, 'Q1', 'a']));
        expect(answered.code, answered.stderr).toBe(0);
        expect(answered.stdout).toBe('Q1: Only an admin. Recorded as D2.\n');
        const changed = await out(stint(repo, ['answer', t.id, 'A1', 'Two', 'new', 'files']));
        expect(changed.stdout).toBe('A1: Two new files. Recorded as D3.\n');

        const proofs = await out(stint(repo, ['proofs', t.id, '--set', '1=human:someone looks; 1=test:"GET /health answers 200"']));
        expect(proofs.code, proofs.stderr).toBe(0);
        expect(proofs.stdout).toContain('1. GET /health answers 200\n   test: GET /health answers 200');
        expect(proofs.stdout).toContain('2. The body says ok\n   suggested test: The body says ok (not accepted; set it with --set 2=test:"The body says ok")');
        expect((await d.ws.readTask(t.id)).proofs).toEqual([{ criterion: 1, kind: 'test', ref: 'GET /health answers 200' }]);
        const bad = await out(stint(repo, ['proofs', t.id, '--set', '1=guess:x']));
        expect(bad.code).toBe(1);
        expect(bad.stderr).toContain('is not a proof');

        // a second task, answered at the prompt: a letter for Q1, Enter for the recommendation on Q2
        const t2 = await d.ws.createTask({ title: 'Add a ready endpoint', goal: 'GET /ready answers 200.', acceptance: ['GET /ready answers 200'], testCommand: 'true' });
        const asked = await out(stint(repo, ['sharpen', t2.id], 'B\n\n'));
        expect(asked.code, asked.stderr).toBe(0);
        expect(asked.stdout).toContain('Q1: needs your answer\nWho may turn the new behaviour off once it ships?');
        expect(asked.stdout).toContain('  A) Only an admin: A person with admin rights changes it. (recommended: It is the smaller change.)');
        expect(asked.stdout).toContain('No safe default: a wrong answer is costly to undo.');
        expect(asked.stdout).toContain('Recorded as D1.');
        expect(asked.stdout).toContain('Recorded as D2.');
        expect((await d.ws.decisions(t2.id).read()).map((x) => x.text)).toEqual([
          'Who may turn the new behaviour off once it ships? Answer: Anyone on the team',
          'Should the change write a log line each time it runs? Answer: One line per run',
        ]);
      } finally {
        await d.stop();
      }
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('A proof reads as <criterion>=<kind>:<ref>, quoted or not', () => {
  expect(parseProof('1=test:"429 with Retry-After"')).toEqual({ criterion: 1, kind: 'test', ref: '429 with Retry-After' });
  expect(parseProof(' 2 = human : Ops checks the dashboard ')).toEqual({ criterion: 2, kind: 'human', ref: 'Ops checks the dashboard' });
  expect(parseProof('1=guess:x')).toBeNull();
  expect(parseProof('test:x')).toBeNull();
});
