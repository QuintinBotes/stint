import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Role, parseSkillFrontmatter } from '@stint-dev/core';
import type { MountedSkill } from './prompt';

/** Active skills in `.agents/skills` that apply to a role (a skill without roles applies to every role). R-020 grows this into the registry. */
export function skillsFor(root: string, role: Role): MountedSkill[] {
  const dir = join(root, '.agents', 'skills');
  if (!existsSync(dir)) return [];
  const out: MountedSkill[] = [];
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    try {
      const { frontmatter } = parseSkillFrontmatter(readFileSync(file, 'utf8'));
      if (frontmatter.status !== 'active') continue;
      if (frontmatter.roles && !frontmatter.roles.includes(role)) continue;
      out.push({ name: frontmatter.name, description: frontmatter.description });
    } catch {
      // a malformed skill is skipped here; the registry (R-020) reports it
    }
  }
  return out;
}
