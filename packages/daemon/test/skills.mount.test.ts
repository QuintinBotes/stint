import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_RECORDING, Replayer } from '../src/index';
import { skillsForTask } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

test('Assigning T-0043 as implementer emits skill.applied for the new skill and review-voice-policy, and prompt.md lists both', async () => {
  await withFixtureRepo(async (repo) => {
    const adapter = fakeAdapter('edit');
    const { app, ws } = await makeApp(repo, [adapter]);
    const r = new Replayer(ws);
    r.load(DEFAULT_RECORDING);
    // through the recorded skill approval, before T-0043 starts
    await r.play({ speed: 0, until: 134_000 });

    // a skill tagged for other work does not mount on T-0043 (tags: admin, limits)
    mkdirSync(join(repo, '.agents', 'skills', 'billing-only'), { recursive: true });
    writeFileSync(
      join(repo, '.agents', 'skills', 'billing-only', 'SKILL.md'),
      '---\nname: billing-only\ndescription: "Use only for billing work."\nroles: [implementer]\ntags: [billing]\nstatus: active\n---\n\nBilling rules.\n',
    );

    const res = await post(app, '/api/tasks/T-0043/assign', { adapter: 'fake', role: 'implementer' });
    expect(res.status).toBe(202);
    const { run } = (await res.json()) as { run: string };

    const applied = (await ws.events('T-0043').read()).filter((e) => e.type === 'skill.applied' && e.run === run).map((e) => e.payload.skill);
    expect(applied).toContain('limiter-config-via-env');
    expect(applied).toContain('review-voice-policy');
    expect(applied).not.toContain('billing-only');

    const prompt = (await ws.runs('T-0043').readPrompt(run)) ?? '';
    expect(prompt).toContain('limiter-config-via-env');
    expect(prompt).toContain('review-voice-policy');
    expect(prompt).not.toContain('billing-only');
    expect(adapter.seen[0]?.skills?.map((s) => s.name)).toEqual(expect.arrayContaining(['limiter-config-via-env', 'review-voice-policy']));

    for (let i = 0; i < 400 && !(await ws.events('T-0043').read()).some((e) => e.type === 'handoff.created' && e.run === run); i++) await Bun.sleep(50);
  });
}, 120_000);

function writeMountSkill(repo: string, id: string, frontmatter: string[]): void {
  mkdirSync(join(repo, '.agents', 'skills', id), { recursive: true });
  writeFileSync(join(repo, '.agents', 'skills', id, 'SKILL.md'), ['---', `name: ${id}`, 'description: "A rule for this test."', ...frontmatter, 'status: active', '---', '', 'The rule.', ''].join('\n'));
}

// R-055 acceptance 1: a skill mounts on an untagged task similar to its evidence task, by `similar`.
test('A skill mounts on an untagged task similar to its evidence task, by similar', async () => {
  await withFixtureRepo(async (repo) => {
    const adapter = fakeAdapter('edit');
    const { app, ws } = await makeApp(repo, [adapter]);

    // the evidence task and the untagged task both touched the limiter, which is what makes them similar
    const evidence = await ws.createTask({ ...newTask, title: 'Evidence for the limiter rule', tags: ['limits'] });
    await ws.events(evidence.id).append({ task: evidence.id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/lib/limiter.ts', added: 10, removed: 1 } });
    await ws.events(evidence.id).append({
      task: evidence.id,
      run: 'r1',
      vendor: 'daemon',
      type: 'review.recorded',
      payload: { verdict: 'request_changes', findings: 1, review: { findings: [{ id: 'F1', severity: 'major', text: 'The limiter limit is a constant in the route.' }] } },
    });
    const untagged = await ws.createTask({ ...newTask, title: 'Untagged limiter work' });
    await ws.events(untagged.id).append({ task: untagged.id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/lib/limiter.ts', added: 4, removed: 0 } });

    writeMountSkill(repo, 'limiter-similar', ['roles: [implementer]', 'tags: [limits]', 'origin: learn-loop', `evidence: ["${evidence.id}/r1#F1"]`]);
    // a tagged skill whose evidence is no similar task does not mount on tags alone here
    writeMountSkill(repo, 'other-evidence', ['roles: [implementer]', 'tags: [limits]', 'origin: learn-loop', 'evidence: ["T-9999/r1#F1"]']);
    // an untagged skill mounts for the role itself
    writeMountSkill(repo, 'every-implementer', ['roles: [implementer]']);

    // the tagged evidence task mounts the skill by tag, which beats similar
    const forEvidence = await skillsForTask(ws, evidence, 'implementer');
    expect(forEvidence.find((s) => s.name === 'limiter-similar')?.by).toBe('tag');
    // above the configured similarity score nothing mounts by similar
    ws.config.skills = { similarity: 99 };
    expect((await skillsForTask(ws, untagged, 'implementer')).map((s) => s.name)).not.toContain('limiter-similar');
    ws.config.skills = { similarity: 0.5 };

    const res = await post(app, `/api/tasks/${untagged.id}/assign`, { adapter: 'fake', role: 'implementer' });
    expect(res.status).toBe(202);
    const { run } = (await res.json()) as { run: string };
    const applied = (await ws.events(untagged.id).read()).filter((e) => e.type === 'skill.applied' && e.run === run);
    expect(applied.find((e) => e.payload.skill === 'limiter-similar')?.payload.by).toBe('similar');
    expect(applied.find((e) => e.payload.skill === 'every-implementer')?.payload.by).toBe('role');
    expect(applied.map((e) => e.payload.skill)).not.toContain('other-evidence');
    expect((await ws.runs(untagged.id).readPrompt(run)) ?? '').toContain('limiter-similar');
    for (let i = 0; i < 400 && !(await ws.events(untagged.id).read()).some((e) => e.type === 'handoff.created' && e.run === run); i++) await Bun.sleep(50);
  });
}, 120_000);
