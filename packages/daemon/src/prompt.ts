import { type Handoff, type Plan, type Task, renderHandoff } from '@stint-dev/core';
import type { NumstatEntry } from './git';

export type MountedSkill = { name: string; description: string };

export type PromptInput = {
  task: Task;
  plan: Plan | null;
  handoff?: Handoff | null;
  /** Lines carried from earlier hops under "Where it got to" (the multi-hop rule, R-012). */
  before?: string[];
  skills: MountedSkill[];
  diff: NumstatEntry[];
  ask?: string | null;
};

const bullets = (items: string[], none: string) => (items.length ? items.map((i) => `- ${i}`).join('\n') : none);

/**
 * The prompt a run starts from. Everything up to the packet is stable for a task, so hosts that cache
 * input (Meta, Fireworks, Baseten) bill it at the cached rate on the next turn; what changes between
 * turns (the packet, the diff, the ask) comes last.
 */
export function renderPrompt(i: PromptInput): string {
  const t = i.task;
  const stable = [
    `# Stint task ${t.id}: ${t.title}`,
    '',
    'You are a coding agent working on one task in a git worktree that Stint created for it. Stint, not you, runs the tests and decides when the work is merged.',
    '',
    'Rules for this run:',
    '- Work only inside this worktree. Do not push, merge or rewrite git history; the person merges through Stint.',
    '- When you make a design decision that should not be silently reversed, write it on its own line as: decision: <the decision>',
    '- Say plainly what you did not finish and what you did not look at.',
    `- After you stop, the daemon runs \`${t.testCommand}\` itself. A claim that the tests pass is not the record.`,
    '',
    '## Goal',
    t.goal,
    '',
    'Acceptance:',
    bullets(t.acceptance, '- none given'),
    '',
    '## Skills mounted for this run',
    bullets(
      i.skills.map((s) => `${s.name}: ${s.description}`),
      'None.',
    ),
    '',
    '## Plan',
    i.plan
      ? i.plan.steps.map((s) => `${s.id}. ${s.text}${s.files.length ? ` (${s.files.join(', ')})` : ''}`).join('\n')
      : 'No plan was made for this task.',
    '',
  ];
  const changing = [
    ...(i.handoff ? ['## Packet from the previous run', renderHandoff(i.handoff, { before: i.before ?? [] }).trimEnd(), ''] : []),
    '## Changes on the task branch so far',
    i.diff.length ? i.diff.map((d) => `- ${d.path} +${d.added} -${d.removed}`).join('\n') : 'None yet.',
    '',
    '## Ask',
    i.ask?.trim() || (i.handoff ? 'Continue from the packet: start with its ask of next.' : 'Implement the goal. Follow the plan where there is one.'),
    '',
  ];
  return [...stable, ...changing].join('\n');
}

/** The byte length of the part every turn of a task shares. */
export function stablePrefixLength(prompt: string): number {
  const at = prompt.indexOf('\n## Packet from the previous run');
  return at >= 0 ? at : prompt.indexOf('\n## Changes on the task branch so far');
}
