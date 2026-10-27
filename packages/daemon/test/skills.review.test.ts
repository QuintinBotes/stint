import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillsFor } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

type SkillRow = { id: string; status: string; stale: boolean };

const rows = async (app: Awaited<ReturnType<typeof makeApp>>['app']): Promise<SkillRow[]> => (await (await app.request('/api/skills')).json()) as SkillRow[];

function writeSkill(repo: string, id: string, body = 'A copied rule.'): void {
  mkdirSync(join(repo, '.agents', 'skills', id), { recursive: true });
  writeFileSync(
    join(repo, '.agents', 'skills', id, 'SKILL.md'),
    ['---', `name: ${id}`, 'description: "A rule for this test."', 'roles: [implementer]', 'status: active', '---', '', body, ''].join('\n'),
  );
}

test('A SKILL.md copied into .agents/skills after the first scan is unreviewed, is not in prompt.md, and emits skill.unreviewed once', async () => {
  await withFixtureRepo(async (repo) => {
    const adapter = fakeAdapter('edit');
    const { app, ws } = await makeApp(repo, [adapter]);
    // the first scan: what the fixture already holds is consented
    expect((await rows(app)).find((s) => s.id === 'review-voice-policy')).toMatchObject({ status: 'active', stale: false });

    writeSkill(repo, 'globex-copied-rule');
    const after = await rows(app);
    expect(after.find((s) => s.id === 'globex-copied-rule')).toMatchObject({ status: 'unreviewed' });
    expect(skillsFor(repo, 'implementer').map((s) => s.name)).not.toContain('globex-copied-rule');

    // listing again does not say it twice
    await rows(app);
    const unreviewed = (await ws.workspaceEvents().read()).filter((e) => e.type === 'skill.unreviewed' && e.payload.id === 'globex-copied-rule');
    expect(unreviewed).toHaveLength(1);

    const task = await ws.createTask(newTask);
    const assigned = await post(app, `/api/tasks/${task.id}/assign`, { adapter: 'fake', role: 'implementer' });
    expect(assigned.status).toBe(202);
    const { run } = (await assigned.json()) as { run: string };
    const prompt = (await ws.runs(task.id).readPrompt(run)) ?? '';
    expect(prompt).not.toContain('globex-copied-rule');
    expect(prompt).toContain('review-voice-policy');
    for (let i = 0; i < 400 && !(await ws.events(task.id).read()).some((e) => e.type === 'handoff.created'); i++) await Bun.sleep(25);
  });
}, 120_000);

test('Skills present at the first scan stay active', async () => {
  await withFixtureRepo(async (repo) => {
    writeSkill(repo, 'acme-already-here');
    const { app } = await makeApp(repo);
    const listed = await rows(app);
    expect(listed.find((s) => s.id === 'acme-already-here')).toMatchObject({ status: 'active', stale: false });
    expect(skillsFor(repo, 'implementer').map((s) => s.name)).toContain('acme-already-here');
  });
}, 60_000);

test('Editing an approved skill makes it stale and unmounted until it is approved again', async () => {
  await withFixtureRepo(async (repo) => {
    const { app } = await makeApp(repo);
    await rows(app);
    const file = join(repo, '.agents', 'skills', 'review-voice-policy', 'SKILL.md');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nAn edit nobody approved.\n`);
    expect((await rows(app)).find((s) => s.id === 'review-voice-policy')?.stale).toBe(true);
    expect(skillsFor(repo, 'implementer').map((s) => s.name)).not.toContain('review-voice-policy');

    const approved = await post(app, '/api/skills/review-voice-policy/approve', {});
    expect(approved.status).toBe(200);
    expect((await rows(app)).find((s) => s.id === 'review-voice-policy')?.stale).toBe(false);
    expect(skillsFor(repo, 'implementer').map((s) => s.name)).toContain('review-voice-policy');
  });
}, 60_000);

test('With requireReview: false, all of these mount as today', async () => {
  await withFixtureRepo(async (repo) => {
    mkdirSync(join(repo, '.stint'), { recursive: true });
    const { app, ws } = await makeApp(repo);
    await ws.writeConfig((raw) => {
      raw.skills = { similarity: 0.5, requireReview: false };
    });
    expect(((await (await app.request('/api/health')).json()) as { skills: { requireReview: boolean } }).skills.requireReview).toBe(false);

    await rows(app);
    writeSkill(repo, 'globex-copied-rule');
    const listed = await rows(app);
    expect(listed.find((s) => s.id === 'globex-copied-rule')).toMatchObject({ status: 'active' });
    expect(skillsFor(repo, 'implementer').map((s) => s.name)).toContain('globex-copied-rule');

    const file = join(repo, '.agents', 'skills', 'review-voice-policy', 'SKILL.md');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nEdited with the gate off.\n`);
    expect((await rows(app)).find((s) => s.id === 'review-voice-policy')?.stale).toBe(true);
    expect(skillsFor(repo, 'implementer').map((s) => s.name)).toContain('review-voice-policy');
    expect((await ws.workspaceEvents().read()).filter((e) => e.type === 'skill.unreviewed')).toEqual([]);
  });
}, 60_000);
