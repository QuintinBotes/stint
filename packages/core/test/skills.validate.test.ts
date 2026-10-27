import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SkillBundleFile, validateSkillBundle } from '../src/index';

const text = (path: string, content: string, mode?: number): SkillBundleFile => ({ path, bytes: new TextEncoder().encode(content), ...(mode !== undefined ? { mode } : {}) });

const good = (name = 'acme-widget-care'): SkillBundleFile[] => [
  text('SKILL.md', `---\nname: ${name}\ndescription: "Use when an acme widget needs care."\nroles: [implementer]\n---\n\n# Widget care\n\nCheck the widget before you change it.\n`),
];

const blocks = (files: SkillBundleFile[]) => validateSkillBundle(files).findings.filter((f) => f.severity === 'block');

describe('validateSkillBundle', () => {
  test('validateSkillBundle refuses ../x', () => {
    const check = validateSkillBundle([...good(), text('../x', 'outside')]);
    expect(check.ok).toBe(false);
    expect(blocks([...good(), text('../x', 'outside')]).some((f) => f.id === 'bad-path')).toBe(true);
  });

  test('validateSkillBundle refuses /etc/x', () => {
    const check = validateSkillBundle([...good(), text('/etc/x', 'absolute')]);
    expect(check.ok).toBe(false);
    expect(check.findings.some((f) => f.id === 'bad-path' && f.severity === 'block')).toBe(true);
  });

  test('validateSkillBundle refuses a symlink mode', () => {
    const linkMode = 0o120777;
    const check = validateSkillBundle([...good(), text('references/link.md', '/some/target', linkMode)]);
    expect(check.ok).toBe(false);
    expect(check.findings.some((f) => f.id === 'not-a-file' && f.severity === 'block')).toBe(true);
  });

  test('validateSkillBundle refuses a 300 KB file', () => {
    const check = validateSkillBundle([...good(), text('references/big.md', 'x'.repeat(300 * 1024))]);
    expect(check.ok).toBe(false);
    expect(check.findings.some((f) => f.id === 'file-too-large' && f.severity === 'block')).toBe(true);
  });

  test('validateSkillBundle refuses 65 files', () => {
    const many = [...good(), ...Array.from({ length: 64 }, (_, i) => text(`references/r${i}.md`, 'note'))];
    const check = validateSkillBundle(many);
    expect(many.length).toBe(65);
    expect(check.ok).toBe(false);
    expect(check.findings.some((f) => f.id === 'too-many-files' && f.severity === 'block')).toBe(true);
  });

  test('validateSkillBundle refuses a bad name', () => {
    const check = validateSkillBundle([text('SKILL.md', '---\nname: Widget Care!\ndescription: "Use for widgets."\n---\n\nBody.\n')]);
    expect(check.ok).toBe(false);
    expect(check.findings.some((f) => f.id === 'frontmatter' && f.severity === 'block')).toBe(true);
  });

  test('validateSkillBundle refuses a missing description', () => {
    const check = validateSkillBundle([text('SKILL.md', '---\nname: acme-widget-care\n---\n\nBody.\n')]);
    expect(check.ok).toBe(false);
    expect(check.findings.some((f) => f.id === 'frontmatter' && f.severity === 'block')).toBe(true);
  });

  test("validateSkillBundle accepts the fixture's review-voice-policy folder", () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-validate-'));
    const bundle = join(import.meta.dir, '..', '..', '..', 'demo', 'repo.bundle');
    expect(Bun.spawnSync(['git', 'clone', '-q', bundle, dir]).exitCode).toBe(0);
    const bytes = readFileSync(join(dir, '.agents/skills/review-voice-policy/SKILL.md'));
    const check = validateSkillBundle([{ path: 'SKILL.md', bytes }]);
    expect(check.ok).toBe(true);
    expect(check.id).toBe('review-voice-policy');
    expect(check.frontmatter?.description.length).toBeGreaterThan(10);
  });

  test('a single top folder is stripped, and a second SKILL.md is refused', () => {
    const wrapped = validateSkillBundle(good().map((f) => ({ ...f, path: `globex-widgets/${f.path}` })));
    expect(wrapped.ok).toBe(true);
    expect(wrapped.files.map((f) => f.path)).toEqual(['SKILL.md']);
    const doubled = validateSkillBundle([...good(), text('references/SKILL.md', '---\nname: other\ndescription: "Other."\n---\n\nBody.\n')]);
    expect(doubled.ok).toBe(false);
  });

  test('a body over 20,000 tokens is refused; over 5,000 only warns', () => {
    const huge = validateSkillBundle([text('SKILL.md', `---\nname: acme-huge\ndescription: "Big."\n---\n\n${'word '.repeat(30_000)}\n`)]);
    expect(huge.ok).toBe(false);
    const large = validateSkillBundle([text('SKILL.md', `---\nname: acme-large\ndescription: "Large."\n---\n\n${'word '.repeat(6_000)}\n`)]);
    expect(large.ok).toBe(true);
    expect(large.findings.some((f) => f.id === 'body-too-large' && f.severity === 'warn')).toBe(true);
  });

  test('an unexpected top-level entry is a note, never a refusal', () => {
    const check = validateSkillBundle([...good(), text('notes.txt', 'hello')]);
    expect(check.ok).toBe(true);
    expect(check.findings).toContainEqual(expect.objectContaining({ id: 'unexpected-entry', severity: 'note' }));
  });
});
