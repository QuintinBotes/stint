import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillFrontmatter } from '@stint-dev/core';
import { daemonContext, gitOk, skillsFor, updateSkillStatuses } from '../src/index';
import { auth, makeApp, newTask, post, withFixtureRepo } from './helpers';

const EVIDENCE_TEXT = 'The limiter limit is a constant in the route, not read from config with a default.';

type Made = Awaited<ReturnType<typeof makeApp>>;

function writeSkill(repo: string, id: string, evidenceRef: string, status = 'probation'): string {
  const dir = join(repo, '.agents', 'skills', id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  writeFileSync(
    file,
    [
      '---',
      `name: ${id}`,
      'description: "Use when adding a limit, threshold, window or cap."',
      'roles: [implementer]',
      'tags: [limits, config]',
      'origin: learn-loop',
      `evidence: ["${evidenceRef}"]`,
      `status: ${status}`,
      '---',
      '',
      'Every limit is read through loadConfig() with a default.',
      '',
    ].join('\n'),
  );
  return file;
}

/** An evidence task carrying the finding the skills were learned from, as r1 finding F1. */
async function evidenceTask(made: Made): Promise<string> {
  const t = await made.ws.createTask({ ...newTask, title: 'Evidence task', tags: ['limits'] });
  await made.ws.events(t.id).append({
    task: t.id,
    run: 'r1',
    vendor: 'daemon',
    type: 'review.recorded',
    payload: { verdict: 'request_changes', findings: 1, review: { findings: [{ id: 'F1', severity: 'major', text: EVIDENCE_TEXT }] } },
  });
  return `${t.id}/r1#F1`;
}

async function mountedTask(made: Made, skill: string, title: string): Promise<string> {
  const t = await made.ws.createTask({ ...newTask, title, tags: ['limits'] });
  await made.ws.events(t.id).append({ task: t.id, run: 'r1', vendor: 'daemon', type: 'skill.applied', payload: { skill, run: 'r1' }, links: [{ kind: 'skill', ref: skill }] });
  return t.id;
}

const reviewWith = (text: string) => ({ verdict: 'request_changes', findings: 1, review: { findings: [{ id: 'F1', severity: 'major', text }] } });

test('A skill with three helped tasks moves from probation to active', async () => {
  await withFixtureRepo(async (repo) => {
    const made = await makeApp(repo);
    const ref = await evidenceTask(made);
    const file = writeSkill(repo, 'config-first', ref);

    // probation mounts while it earns its record (R-031 requirement 5)
    expect(skillsFor(repo, 'implementer', ['limits']).map((s) => s.name)).toContain('config-first');

    for (let i = 1; i <= 3; i++) {
      const id = await mountedTask(made, 'config-first', `Helped task ${i}`);
      await made.ws.events(id).append({ task: id, run: 'r2', vendor: 'daemon', type: 'review.recorded', payload: reviewWith('A test name could say more about the tenant case.') });
      await made.ws.events(id).append({ task: id, vendor: 'human', type: 'approval.granted', payload: { by: 'you' } });
    }

    const before = (await (await made.app.request('/api/skills')).json()) as Array<{ id: string; status: string; helped: number; hurt: number }>;
    // a read never changes a status; the pass below is what writes it
    expect(before.find((s) => s.id === 'config-first')).toMatchObject({ status: 'probation', helped: 3, hurt: 0 });

    const pass = await updateSkillStatuses(daemonContext(made.app));
    expect(pass.changed).toEqual([{ id: 'config-first', from: 'probation', to: 'active', helped: 3, hurt: 0 }]);
    expect(parseSkillFrontmatter(readFileSync(file, 'utf8')).frontmatter.status).toBe('active');
    expect(await gitOk(repo, ['log', '-1', '--format=%B'])).toContain('Skill config-first is now active');

    const carrier = ref.split('/')[0] as string;
    const status = (await made.ws.events(carrier).read()).find((e) => e.type === 'skill.status');
    expect(status?.payload).toMatchObject({ id: 'config-first', from: 'probation', to: 'active', helped: 3, hurt: 0 });

    const after = (await (await made.app.request('/api/skills')).json()) as Array<{ id: string; status: string; retireProposed: boolean }>;
    expect(after.find((s) => s.id === 'config-first')).toMatchObject({ status: 'active', retireProposed: false });
  });
}, 120_000);

test('one with hurt > helped raises a retirement proposal', async () => {
  await withFixtureRepo(async (repo) => {
    const made = await makeApp(repo);
    const ref = await evidenceTask(made);
    writeSkill(repo, 'noisy-rule', ref);

    const helped = await mountedTask(made, 'noisy-rule', 'The one it helped');
    await made.ws.events(helped).append({ task: helped, vendor: 'human', type: 'approval.granted', payload: { by: 'you' } });

    const repeated = await mountedTask(made, 'noisy-rule', 'The same finding again');
    await made.ws.events(repeated).append({ task: repeated, run: 'r2', vendor: 'daemon', type: 'review.recorded', payload: reviewWith(EVIDENCE_TEXT) });
    await made.ws.events(repeated).append({ task: repeated, vendor: 'human', type: 'approval.granted', payload: { by: 'you' } });

    const rejected = await mountedTask(made, 'noisy-rule', 'Sent back');
    await made.ws.events(rejected).append({ task: rejected, vendor: 'human', type: 'approval.rejected', payload: { reason: 'The constant is still in the route' } });

    const reverted = await mountedTask(made, 'noisy-rule', 'Merged then reverted');
    await made.ws.events(reverted).append({ task: reverted, vendor: 'daemon', type: 'outcome.reverted', payload: { task: reverted, commit: 'abc1234', by: 'you' } });

    const pass = await updateSkillStatuses(daemonContext(made.app));
    expect(pass.retireProposed).toEqual(['noisy-rule']);
    const carrier = ref.split('/')[0] as string;
    const proposals = (await made.ws.events(carrier).read()).filter((e) => e.type === 'skill.retire_proposed');
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.payload).toMatchObject({ id: 'noisy-rule', helped: 1, hurt: 3 });

    // the same counts never propose twice
    const again = await updateSkillStatuses(daemonContext(made.app));
    expect(again.retireProposed).toEqual([]);
    expect((await made.ws.events(carrier).read()).filter((e) => e.type === 'skill.retire_proposed')).toHaveLength(1);

    const rows = (await (await made.app.request('/api/skills')).json()) as Array<{ id: string; helped: number; hurt: number; retireProposed: boolean; status: string }>;
    expect(rows.find((s) => s.id === 'noisy-rule')).toMatchObject({ helped: 1, hurt: 3, retireProposed: true, status: 'probation' });

    // Keep clears the proposal at these counts; a fresh hurt raises it again, and Retire accepts it
    const kept = await post(made.app, '/api/skills/noisy-rule/keep', {});
    expect(kept.status).toBe(200);
    const afterKeep = (await (await made.app.request('/api/skills')).json()) as typeof rows;
    expect(afterKeep.find((s) => s.id === 'noisy-rule')?.retireProposed).toBe(false);

    const hurtAgain = await mountedTask(made, 'noisy-rule', 'Hurt once more');
    await made.ws.events(hurtAgain).append({ task: hurtAgain, vendor: 'human', type: 'approval.rejected', payload: { reason: 'Still a constant' } });
    expect((await updateSkillStatuses(daemonContext(made.app))).retireProposed).toEqual(['noisy-rule']);

    const retired = await made.app.request('/api/skills/noisy-rule/retire', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
    expect(retired.status).toBe(200);
    const afterRetire = (await (await made.app.request('/api/skills')).json()) as typeof rows;
    expect(afterRetire.find((s) => s.id === 'noisy-rule')).toMatchObject({ status: 'retired', retireProposed: false });
    expect(skillsFor(repo, 'implementer', ['limits']).map((s) => s.name)).not.toContain('noisy-rule');
  });
}, 120_000);
