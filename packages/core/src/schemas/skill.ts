import { z } from 'zod';
import { RoleSchema } from './handoff';

/** Where a skill came from, when Stint brought it in or a person wrote it here (R-060). */
export const SkillSourceSchema = z.strictObject({
  kind: z.enum(['upload', 'folder', 'zip', 'git', 'editor']),
  ref: z.string().min(1),
  commit: z.string().min(1).optional(),
});
export type SkillSource = z.infer<typeof SkillSourceSchema>;

/** SKILL.md frontmatter: what Muse Code and other coding agents read, plus Stint's additions. */
export const SkillFrontmatterSchema = z.looseObject({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(64),
  description: z.string().min(1).max(1024),
  roles: z.array(RoleSchema).optional(),
  tags: z.array(z.string()).optional(),
  version: z.string().optional(),
  origin: z.enum(['human', 'import', 'learn-loop']).optional(),
  evidence: z.array(z.string()).optional(),
  status: z.enum(['active', 'probation', 'proposed', 'unreviewed', 'retired']).optional(),
  source: SkillSourceSchema.optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** A learned skill starts on probation and earns active from its track record (R-031). */
export type SkillStatus = 'active' | 'probation' | 'proposed' | 'unreviewed' | 'retired';

export type SkillOrigin = 'human' | 'import' | 'learn-loop';

export type ParsedSkill = {
  frontmatter: SkillFrontmatter & { origin: SkillOrigin; status: SkillStatus };
  body: string;
};

const FENCE = /^---[ \t]*\r?\n/;

/**
 * Reads the YAML frontmatter of a SKILL.md. Tolerates an empty leading `---\n---` pair before the
 * real block (a quirk some skill files have) and files with only `name` and `description`.
 * Applies the schema defaults: origin `human`, status `active`.
 */
export function parseSkillFrontmatter(md: string): ParsedSkill {
  let text = md.charCodeAt(0) === 0xfeff ? md.slice(1) : md;
  const emptyPair = /^---[ \t]*\r?\n---[ \t]*\r?\n/;
  if (emptyPair.test(text)) {
    text = text.replace(emptyPair, '');
    // the YAML may follow the empty pair directly, without its own opening fence
    if (!FENCE.test(text)) text = `---\n${text}`;
  }
  if (!FENCE.test(text)) throw new Error('SKILL.md has no frontmatter');
  const rest = text.replace(FENCE, '');
  const end = rest.search(/^---[ \t]*$/m);
  if (end < 0) throw new Error('SKILL.md frontmatter is not closed');
  const yaml = rest.slice(0, end);
  const body = rest.slice(end).replace(/^---[ \t]*\r?\n?/, '');
  const data = SkillFrontmatterSchema.parse(Bun.YAML.parse(yaml) ?? {});
  return {
    frontmatter: { ...data, origin: data.origin ?? 'human', status: data.status ?? 'active' },
    body,
  };
}
