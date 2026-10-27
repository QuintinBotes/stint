import { expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { withFixtureRepo } from '../../core/test/fixture';
import { init } from '../src/init';

test('stint init creates the CLAUDE.md link only once a Claude Code agent is enabled, and never over an existing file', async () => {
  await withFixtureRepo(async (repo) => {
    // Meta only, the default: no other agent's file appears
    await init(repo);
    expect(existsSync(join(repo, 'CLAUDE.md'))).toBe(false);
    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toContain('.agents/skills/<id>/SKILL.md');

    const config = JSON.parse(readFileSync(join(repo, '.stint', 'config.json'), 'utf8')) as typeof DEFAULT_CONFIG;
    (config.agents?.['claude-code'] as { enabled: boolean }).enabled = true;
    writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
    expect((await init(repo)).changed).toEqual(['CLAUDE.md']);
    expect(lstatSync(join(repo, 'CLAUDE.md')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(repo, 'CLAUDE.md'))).toBe('AGENTS.md');
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf8')).toBe(readFileSync(join(repo, 'AGENTS.md'), 'utf8'));
    expect((await init(repo)).changed).toEqual([]);
  });
  await withFixtureRepo(async (repo) => {
    mkdirSync(join(repo, '.stint'), { recursive: true });
    const config = structuredClone(DEFAULT_CONFIG);
    (config.agents?.['claude-code'] as { enabled: boolean }).enabled = true;
    writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
    writeFileSync(join(repo, 'CLAUDE.md'), 'notes the team wrote\n');
    await init(repo);
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf8')).toBe('notes the team wrote\n');
  });
});
