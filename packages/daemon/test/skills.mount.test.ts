import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_RECORDING, Replayer } from '../src/index';
import { fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

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
