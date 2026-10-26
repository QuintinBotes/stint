import { expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillsFor } from '../src/index';
import { auth, makeApp, post, withFixtureRepo } from './helpers';

type SkillRow = { id: string; origin: string; status: string; stale: boolean; roles: string[]; tags: string[] };

async function skills(app: Awaited<ReturnType<typeof makeApp>>['app']): Promise<SkillRow[]> {
  return (await (await app.request('/api/skills')).json()) as SkillRow[];
}

test('The registry lists review-voice-policy from the fixture with origin: human and status: active, and flags it stale after the file changes', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const file = join(repo, '.agents', 'skills', 'review-voice-policy', 'SKILL.md');

    const before = (await skills(app)).find((s) => s.id === 'review-voice-policy');
    expect(before).toMatchObject({ origin: 'human', status: 'active', stale: false });
    expect(existsSync(join(ws.cacheDir, 'skills-consent.json'))).toBe(true);

    writeFileSync(file, `${readFileSync(file, 'utf8')}\nA later edit the person has not approved.\n`);
    const after = (await skills(app)).find((s) => s.id === 'review-voice-policy');
    expect(after).toMatchObject({ origin: 'human', status: 'active', stale: true });
  });
}, 60_000);

test('approving a stale skill clears stale, and retiring it stops it mounting', async () => {
  await withFixtureRepo(async (repo) => {
    const { app } = await makeApp(repo);
    const file = join(repo, '.agents', 'skills', 'review-voice-policy', 'SKILL.md');
    await skills(app);
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nChanged.\n`);
    expect((await skills(app))[0]?.stale).toBe(true);

    const approved = await post(app, '/api/skills/review-voice-policy/approve', {});
    expect(approved.status).toBe(200);
    expect((await skills(app))[0]?.stale).toBe(false);

    const retired = await app.request('/api/skills/review-voice-policy/retire', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
    expect(retired.status).toBe(200);
    expect((await skills(app))[0]?.status).toBe('retired');
    expect(skillsFor(repo, 'implementer')).toEqual([]);
  });
}, 60_000);
