import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Handoff, Plan, Task } from '@stint-dev/core';
import { renderPrompt, stablePrefixLength } from '../src/index';

const ex = (n: string) => JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'core', 'schemas', 'examples', `${n}.json`), 'utf8'));
const task = ex('task') as Task;
const plan = ex('plan') as Plan;
const skills = [{ name: 'review-voice-policy', description: 'How review policies work.' }];

test('prompt.md for a second turn shares a byte-identical prefix up to the packet section', () => {
  const first = renderPrompt({ task, plan, skills, diff: [] });
  const second = renderPrompt({
    task,
    plan,
    skills,
    handoff: ex('handoff-killed') as Handoff,
    diff: [{ path: 'src/lib/limiter.ts', added: 26, removed: 0 }],
    ask: 'Check the unknown step first.',
  });
  const n = stablePrefixLength(first);
  expect(n).toBeGreaterThan(400);
  expect(second.slice(0, n)).toBe(first.slice(0, n));
  expect(second.indexOf('## Packet from the previous run')).toBe(n + 1);
  expect(second).toContain('You are picking up work in progress.');
  expect(second.indexOf('## Packet from the previous run')).toBeLessThan(second.indexOf('## Changes on the task branch so far'));
});

test('the mounted skills section of prompt.md is one "- name: description" line per skill, or None.', () => {
  const two = [
    { name: 'review-voice-policy', description: 'How review policies work.' },
    { name: 'limits-come-from-config', description: 'Read limits from config, not literals.' },
  ];
  const section = (p: string) => p.slice(p.indexOf('## Skills mounted for this run'), p.indexOf('## Plan'));
  expect(section(renderPrompt({ task, plan, skills: two, diff: [] }))).toBe('## Skills mounted for this run\n- review-voice-policy: How review policies work.\n- limits-come-from-config: Read limits from config, not literals.\n\n');
  expect(section(renderPrompt({ task, plan, skills: [], diff: [] }))).toBe('## Skills mounted for this run\nNone.\n\n');
});
