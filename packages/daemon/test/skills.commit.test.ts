import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type SkillProposal } from '@stint-dev/core';
import { approveSkill } from '../src/skills';
import { makeApp, withFixtureRepo } from './helpers';

const proposal: SkillProposal = {
  version: 'stint.skillProposal/1',
  id: 'limits-from-config',
  name: 'limits-from-config',
  description: 'Read limits through loadConfig, never as literals.',
  roles: ['implementer'],
  tags: ['limits'],
  rule: 'Read every limit and window through loadConfig() with a default.',
  examples: [],
  evidence: ['T-0040/r1#F2', 'T-0042/r3#F1'],
  confidence: 0.8,
};

const git = (repo: string, ...args: string[]) => Bun.spawnSync(['git', '-C', repo, ...args], { stdout: 'pipe', stderr: 'pipe' });

async function setup(repo: string, commitTo: string) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.skills = { similarity: 0.5, commitTo };
  mkdirSync(join(repo, '.stint', 'cache', 'proposals'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
  writeFileSync(join(repo, '.stint', 'cache', 'proposals', `${proposal.id}.json`), JSON.stringify(proposal));
  return makeApp(repo);
}

// R-055 acceptance 2: with skills.commitTo set, approve commits there; a missing branch is refused.
test('With skills.commitTo set, approve commits the skill to that branch and leaves the checked out branch alone', async () => {
  await withFixtureRepo(async (repo) => {
    expect(git(repo, 'branch', 'skill-target', 'HEAD').exitCode).toBe(0);
    const { ws } = await setup(repo, 'skill-target');
    const headBefore = git(repo, 'rev-parse', 'HEAD').stdout.toString().trim();

    const approved = await approveSkill(ws, proposal.id);
    expect(approved.committed).toBe(true);
    expect(approved.commit).toBe(git(repo, 'rev-parse', 'skill-target').stdout.toString().trim());
    expect(git(repo, 'rev-parse', 'HEAD').stdout.toString().trim()).toBe(headBefore);

    const files = git(repo, 'show', '--name-only', '--format=', 'skill-target').stdout.toString().trim().split('\n').sort();
    expect(files).toEqual(['.agents/skills/limits-from-config/SKILL.md', '.agents/skills/limits-from-config/examples.md']);
    expect(git(repo, 'log', '-1', '--format=%s', 'skill-target').stdout.toString().trim()).toBe('Add skill limits-from-config');
    expect(git(repo, 'show', 'skill-target:.agents/skills/limits-from-config/SKILL.md').stdout.toString()).toContain('status: probation');
  });
}, 60_000);

test('A skills.commitTo branch that does not exist is refused and nothing is written', async () => {
  await withFixtureRepo(async (repo) => {
    const { ws } = await setup(repo, 'no-such-branch');
    await expect(approveSkill(ws, proposal.id)).rejects.toThrow(/no-such-branch/);
    expect(existsSync(join(repo, '.agents', 'skills', proposal.id, 'SKILL.md'))).toBe(false);
    expect(existsSync(join(repo, '.stint', 'cache', 'proposals', `${proposal.id}.json`))).toBe(true);
  });
}, 60_000);
