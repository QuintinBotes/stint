import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Scorecard, ScorecardSchema } from '@stint-dev/core';
import { makeApp, tempDir, withFixtureRepo } from './helpers';

const EXAMPLE = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'core', 'schemas', 'examples', 'scorecard.json'), 'utf8')) as Scorecard;

async function inRepo(fn: (dir: string) => Promise<void>): Promise<void> {
  const tmp = tempDir();
  try {
    Bun.spawnSync(['git', 'init', '-q'], { cwd: tmp.dir });
    mkdirSync(join(tmp.dir, 'bench'));
    await fn(tmp.dir);
  } finally {
    tmp.cleanup();
  }
}

test("a repository's own scorecard is served as recorded, with every figure's run count", async () => {
  await inRepo(async (dir) => {
    writeFileSync(join(dir, 'bench', 'scorecard.json'), JSON.stringify(EXAMPLE));
    const { app } = await makeApp(dir);
    const res = await app.request('/api/scorecard');
    expect(res.status).toBe(200);
    const card = (await res.json()) as Scorecard;
    expect(card).toEqual(EXAMPLE);
    expect(card.tasks.map((t) => [t.id, t.pass1, t.passK])).toEqual([
      ['ms-unit-option', { value: null, n: 0 }, { value: null, n: 0 }],
      ['negotiator-preferred', { value: 0.3333, n: 3 }, { value: 0, n: 3 }],
    ]);
    expect(card.review).toEqual({ n: 2, caught: 1, missed: 0, falseAlarm: 0, agreed: 1 });
    expect(card.perGreen).toEqual({ usd: { value: 0.2811, n: 1, unpriced: 0 }, wallMs: { value: 512000, n: 1 } });
  });
});

test('a repository with no scorecard of its own, and not the demo fixture, gets 404 so the Factory says none was run here', async () => {
  await inRepo(async (dir) => {
    const { app } = await makeApp(dir);
    const res = await app.request('/api/scorecard');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'no scorecard yet', hint: 'Stint writes bench/scorecard.json with bun scripts/scorecard.ts' } });
  });
});

test('a scorecard that is not JSON, or not the scorecard schema, is refused with what to do', async () => {
  await inRepo(async (dir) => {
    const { app } = await makeApp(dir);
    writeFileSync(join(dir, 'bench', 'scorecard.json'), '{ not json');
    const torn = await app.request('/api/scorecard');
    expect(torn.status).toBe(400);
    expect(await torn.json()).toEqual({ error: { code: 'invalid', message: 'bench/scorecard.json is not valid JSON', hint: 'run the scorecard again' } });
    writeFileSync(join(dir, 'bench', 'scorecard.json'), JSON.stringify({ ...EXAMPLE, version: 'stint.scorecard/0' }));
    const wrong = await app.request('/api/scorecard');
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: { code: 'invalid', message: 'bench/scorecard.json is not a stint.scorecard/1 record', hint: 'run the scorecard again' } });
  });
});

test("the demo fixture has no scorecard of its own, so it shows Stint's, as the bench does", async () => {
  await withFixtureRepo(async (repo) => {
    const { app } = await makeApp(repo);
    const res = await app.request('/api/scorecard');
    expect(res.status).toBe(200);
    const stint = ScorecardSchema.parse(JSON.parse(readFileSync(join(import.meta.dir, '..', '..', '..', 'bench', 'scorecard.json'), 'utf8')));
    expect(await res.json()).toEqual(stint);
  });
}, 60_000);
