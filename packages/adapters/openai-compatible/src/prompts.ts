import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plan } from '@stint-dev/core';
import { capDiff } from './diff';

export type SkillHint = { name: string; description: string; body?: string };
export type PlanTaskInput = { id: string; title: string; goal: string; acceptance: string[] };
export type SimilarTaskInput = { id: string; title: string; summary: string };

const FALLBACK_PLAN = [
  'You are the planner for Stint. Return only JSON matching the schema given with this prompt.',
  '## Skills\n{{skills}}\n\n## Similar tasks\n{{similarTasks}}\n\n## Constraints on the files this task touches\n{{constraints}}\n\n## Context\n{{context}}\n\n## The task\n{{task}}\n\n## Ask\nWrite the plan for this task now. Set version to "stint.plan/1". Follow every decision under Constraints. Return subtasks only for a task too large for one run.',
].join('\n\n');

const FALLBACK_REVIEW = [
  'You are the reviewer for Stint. Return only JSON matching the schema given with this prompt.',
  'If there is nothing actionable, use summary exactly "No actionable findings." and verdict "approve".',
  '## Reviewer skills\n{{skills}}\n\n## Decisions\n{{decisions}}\n\n## The packet\n{{packet}}\n\n## The diff\n{{diff}}\n\n## Ask\nReview this diff now. Set version to "stint.review/1".',
].join('\n\n');

function loadTemplate(name: string, fallback: string): string {
  try {
    return readFileSync(fileURLToPath(new URL(`../prompts/${name}`, import.meta.url)), 'utf8');
  } catch {
    return fallback;
  }
}

function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.split(`{{${key}}}`).join(value);
  return out;
}

function renderSkills(skills: SkillHint[] | undefined, includeBody: boolean): string {
  if (!skills || skills.length === 0) return '- none';
  return skills
    .map((skill) => {
      const head = `- ${skill.name}: ${skill.description}`;
      return includeBody && skill.body ? `${head}\n${skill.body}` : head;
    })
    .join('\n');
}

/** Cache-stable order: system framing and skills first, then task facts, the ask last. */
export function buildPlanPrompt(input: {
  task: PlanTaskInput;
  context?: unknown;
  similarTasks?: SimilarTaskInput[];
  constraints?: Array<{ kind: 'decision' | 'finding'; id: string; task: string; text: string; files: string[] }>;
  skills?: SkillHint[];
}): string {
  const taskLines = [
    `Id: ${input.task.id}`,
    `Title: ${input.task.title}`,
    `Goal: ${input.task.goal}`,
    'Acceptance:',
    ...(input.task.acceptance.length > 0 ? input.task.acceptance.map((line) => `- ${line}`) : ['- none']),
  ];
  const similar = input.similarTasks && input.similarTasks.length > 0
    ? input.similarTasks.map((task) => `- ${task.id} ${task.title}: ${task.summary}`).join('\n')
    : '- none';
  const context = input.context === undefined ? '- none' : typeof input.context === 'string' ? input.context : JSON.stringify(input.context, null, 2);
  return fill(loadTemplate('plan.md', FALLBACK_PLAN), {
    skills: renderSkills(input.skills, false),
    similarTasks: similar,
    constraints: input.constraints?.length ? input.constraints.map((c) => `- ${c.kind} ${c.id} (${c.task}, on ${c.files.join(', ')}): ${c.text}`).join('\n') : '- none',
    context,
    task: taskLines.join('\n'),
  });
}

/** Reviewer skills come first with review-voice-policy ahead of the rest; the ask stays last. */
export function buildReviewPrompt(input: {
  packetPrompt: string;
  diff: string;
  decisions: Array<{ id: string; text: string }>;
  skills?: SkillHint[];
  /** One job for this review (R-038); the general review has none. */
  lens?: 'general' | 'security' | 'spec-fit';
  acceptance?: string[];
}): string {
  const skills = [...(input.skills ?? [])].sort((a, b) => {
    const aVoice = a.name === 'review-voice-policy' ? 0 : 1;
    const bVoice = b.name === 'review-voice-policy' ? 0 : 1;
    return aVoice - bVoice;
  });
  const decisions = input.decisions.length > 0
    ? input.decisions.map((d) => `- ${d.id}: ${d.text}`).join('\n')
    : '- none';
  return fill(loadTemplate('review.md', FALLBACK_REVIEW), {
    skills: renderSkills(skills, true),
    decisions,
    packet: input.packetPrompt,
    diff: capDiff(input.diff, 3000).text,
  }) + lensAsk(input.lens, input.acceptance ?? []);
}

/** What a lens review looks for instead of everything (R-038). */
function lensAsk(lens: string | undefined, acceptance: string[]): string {
  if (lens === 'security') {
    return '\n\n## Lens: security\nReview this diff for security only: injection (SQL, shell, path traversal), secrets in code, config or logs, missing authentication or authorization checks, unsafe handling of untrusted input, unsafe deserialization, server-side request forgery, and new network or file access the task does not need. Ignore style and design. Block on anything exploitable; request changes for a real weakness; approve when there is nothing.';
  }
  if (lens === 'spec-fit') {
    const lines = acceptance.length ? acceptance.map((a, i) => `${i + 1}. ${a}`).join('\n') : '- none given';
    return `\n\n## Lens: spec fit\nReview only whether the change does what the task asks. For each acceptance criterion below that the diff does not meet, add a finding (severity major) naming the criterion and what is missing. Do not add findings for criteria that are met. Request changes when any criterion is not met; approve when all are.\n\nAcceptance criteria:\n${lines}`;
  }
  return '';
}

/** The plan.md a human reads: numbered steps with files and tests, files to touch, risks. */
export function renderPlanMarkdown(plan: Plan): string {
  const lines: string[] = ['# Plan', ''];
  for (const step of plan.steps) {
    lines.push(`${step.id}. ${step.text}`);
    if (step.files.length > 0) lines.push(`   Files: ${step.files.join(', ')}`);
    if (step.test) lines.push(`   Test: ${step.test}`);
  }
  lines.push('', '## Files to touch');
  lines.push(...(plan.filesToTouch.length > 0 ? plan.filesToTouch.map((file) => `- ${file}`) : ['- none']));
  lines.push('', '## Risks');
  lines.push(...(plan.risks.length > 0 ? plan.risks.map((risk) => `- ${risk.id}: ${risk.text}`) : ['- none']));
  if (plan.decisions && plan.decisions.length > 0) {
    lines.push('', '## Decisions');
    lines.push(...plan.decisions.map((d) => (d.why ? `- ${d.text} (${d.why})` : `- ${d.text}`)));
  }
  if (plan.similarTasks.length > 0) {
    lines.push('', '## Similar tasks');
    lines.push(...plan.similarTasks.map((id) => `- ${id}`));
  }
  lines.push('');
  return lines.join('\n');
}
