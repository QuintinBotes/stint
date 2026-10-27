import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readme = readFileSync(join(import.meta.dir, '..', '..', '..', 'README.md'), 'utf8');

const SECTIONS = ['Three proofs', 'Quick start', 'Install', 'Use it on your repository', 'Everyday commands', 'Agents and models', 'Troubleshooting', 'How it works', 'More'];

/** What the README's shape breaks, per R-059 Requirement 1. */
export function structureProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length > 180) problems.push(`${lines.length} lines; the limit is 180`);
  const headings = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
  if (JSON.stringify(headings) !== JSON.stringify(SECTIONS)) problems.push(`sections are ${headings.join(', ')}; expected ${SECTIONS.join(', ')}`);
  const section = (name: string) => {
    const at = lines.indexOf(`## ${name}`);
    if (at < 0) return [];
    const end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
    return lines.slice(at + 1, end < 0 ? undefined : end);
  };
  // 1: the logo, the tagline, one paragraph and the task screenshot come before the first section
  const intro = lines.slice(0, Math.max(0, lines.findIndex((l) => l.startsWith('## ')))).join('\n');
  for (const [what, re] of [['the logo', /assets\/logo/], ['the tagline', /<h3 align="center">/], ['the task screenshot', /assets\/screenshot-task\.png/]] as const) if (!re.test(intro)) problems.push(`the opening has no ${what}`);
  const rows = (name: string) => section(name).filter((l) => l.startsWith('| ') && !/^\|[-| ]+\|$/.test(l)).length - 1;
  if (rows('Everyday commands') > 12) problems.push(`Everyday commands has ${rows('Everyday commands')} rows; the limit is 12`);
  if (rows('Troubleshooting') !== 8) problems.push(`Troubleshooting has ${rows('Troubleshooting')} rows; it lists the eight likely failures`);
  const steps = section('Use it on your repository').filter((l) => /^\d+\. \*\*/.test(l)).length;
  if (steps !== 7) problems.push(`Use it on your repository has ${steps} numbered steps; it has seven`);
  const how = section('How it works').filter((l) => l.trim()).length;
  if (how > 10) problems.push(`How it works is ${how} lines; the limit is 10`);
  if (!/stint doctor/.test(section('Install').join('\n'))) problems.push('Install does not mention stint doctor');
  if (!/docs\/agents\.md/.test(section('Agents and models').join('\n'))) problems.push('Agents and models does not link docs/agents.md');
  const more = section('More').join('\n');
  for (const link of ['docs/README.md', 'LICENSE']) if (!more.includes(`(${link})`)) problems.push(`More does not link ${link}`);
  if (/bun x @stint-dev\/cli/.test(text)) problems.push('names bun x @stint-dev/cli, which is not published');
  return problems;
}

test('R-059 Acceptance 1: README.md has the ten sections in order, under their exact names, in at most 180 lines', () => {
  expect(structureProblems(readme)).toEqual([]);
});

test('the structure check fails when a section moves, a line is added past the limit, or a row is added', () => {
  const swapped = readme.replace('## Install\n', '## Installing\n');
  expect(structureProblems(swapped)).toContainEqual(expect.stringContaining('sections are'));
  expect(structureProblems(`${readme}${'\n'.repeat(200)}`)).toContainEqual(expect.stringContaining('the limit is 180'));
  const extraRow = readme.replace('| Symptom | Cause | Fix |\n|---|---|---|\n', '| Symptom | Cause | Fix |\n|---|---|---|\n| a | b | c |\n');
  expect(structureProblems(extraRow)).toContainEqual(expect.stringContaining('Troubleshooting has 9 rows'));
});
