import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type SkillProposal } from '@stint-dev/core';
import { approveSkill, retireSkill } from '../src/skills';
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

const git = (repo: string, ...args: string[]) => Bun.spawnSync(['git', '-C', repo, ...args], { stdout: 'pipe' }).stdout.toString().trim();

async function setup(repo: string, claude: boolean) {
  const config = structuredClone(DEFAULT_CONFIG);
  (config.agents?.['claude-code'] as { enabled: boolean }).enabled = claude;
  mkdirSync(join(repo, '.stint', 'cache', 'proposals'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
  writeFileSync(join(repo, '.stint', 'cache', 'proposals', `${proposal.id}.json`), JSON.stringify(proposal));
  return makeApp(repo);
}

test('Approving a skill writes both copies in one commit when Claude Code is enabled, and retiring removes the copy', async () => {
  await withFixtureRepo(async (repo) => {
    const { ws } = await setup(repo, true);
    const approved = await approveSkill(ws, proposal.id);
    expect(approved.committed).toBe(true);
    const files = git(repo, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort();
    expect(files).toEqual(['.agents/skills/limits-from-config/SKILL.md', '.agents/skills/limits-from-config/examples.md', '.claude/skills/limits-from-config/SKILL.md']);
    expect(readFileSync(join(repo, '.claude/skills/limits-from-config/SKILL.md'), 'utf8')).toBe(readFileSync(join(repo, '.agents/skills/limits-from-config/SKILL.md'), 'utf8'));

    await retireSkill(ws, proposal.id);
    expect(existsSync(join(repo, '.claude/skills/limits-from-config/SKILL.md'))).toBe(false);
    expect(git(repo, 'show', '--name-status', '--format=', 'HEAD')).toContain('D\t.claude/skills/limits-from-config/SKILL.md');
  });
}, 60_000);

test('With only Meta agents enabled, approving a skill writes no .claude copy', async () => {
  await withFixtureRepo(async (repo) => {
    const { ws } = await setup(repo, false);
    await approveSkill(ws, proposal.id);
    expect(existsSync(join(repo, '.claude'))).toBe(false);
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD')).not.toContain('.claude');
  });
}, 60_000);
