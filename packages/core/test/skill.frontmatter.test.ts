import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillFrontmatter } from '../src/index';

describe('parseSkillFrontmatter', () => {
  test('reads a file with only name and description and applies the defaults', () => {
    const s = parseSkillFrontmatter('---\nname: x-y\ndescription: Does x.\n---\n# Body\n');
    expect(s.frontmatter).toEqual({ name: 'x-y', description: 'Does x.', origin: 'human', status: 'active' });
    expect(s.body).toBe('# Body\n');
  });

  test('tolerates an empty leading ---/--- pair, before a fenced block or bare YAML', () => {
    const fenced = parseSkillFrontmatter('---\n---\n---\nname: a\ndescription: b\n---\nbody');
    const bare = parseSkillFrontmatter('---\n---\nname: a\ndescription: b\n---\nbody');
    expect(fenced.frontmatter.name).toBe('a');
    expect(bare.frontmatter.name).toBe('a');
    expect(bare.body).toBe('body');
  });

  test('reads Stint\'s additions', () => {
    const s = parseSkillFrontmatter('---\nname: limiter-config-via-env\ndescription: d\nroles: [implementer, reviewer]\norigin: learn-loop\nevidence: ["T-0042/r4#F1", "T-0040/r3#F2"]\n---\n');
    expect(s.frontmatter.roles).toEqual(['implementer', 'reviewer']);
    expect(s.frontmatter.origin).toBe('learn-loop');
  });

  test('reads the fixture\'s review-voice-policy skill unchanged from review-voice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-'));
    const bundle = join(import.meta.dir, '..', '..', '..', 'demo', 'repo.bundle');
    expect(Bun.spawnSync(['git', 'clone', '-q', bundle, dir]).exitCode).toBe(0);
    const s = parseSkillFrontmatter(readFileSync(join(dir, '.agents/skills/review-voice-policy/SKILL.md'), 'utf8'));
    expect(s.frontmatter).toMatchObject({ name: 'review-voice-policy', origin: 'human', status: 'active' });
    expect(s.body).toContain('# Review Voice policy authoring');
  });
});
