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
