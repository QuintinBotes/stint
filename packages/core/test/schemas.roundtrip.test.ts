import { describe, expect, test } from 'bun:test';
import {
  CapabilityLevelSchema,
  ConfigSchema,
  DEFAULT_CONFIG,
  HandoffSchema,
  OutcomeSchema,
  PlanSchema,
  ReviewSchema,
  SkillFrontmatterSchema,
  SkillProposalSchema,
  StintEventSchema,
  TaskSchema,
} from '../src/index';
import { example } from './ajv';

const cases: Array<[string, { parse: (x: unknown) => unknown }, unknown]> = [
  ['task', TaskSchema, example('task')],
  ['event', StintEventSchema, example('event')],
  ['handoff completed', HandoffSchema, example('handoff-completed')],
  ['handoff killed', HandoffSchema, example('handoff-killed')],
  ['handoff capped', HandoffSchema, example('handoff-capped')],
  ['plan', PlanSchema, example('plan')],
  ['review', ReviewSchema, example('review')],
  ['outcome', OutcomeSchema, example('outcome')],
  ['skill proposal', SkillProposalSchema, example('skill-proposal')],
  ['skill frontmatter', SkillFrontmatterSchema, { name: 'review-voice-policy', description: 'How policies work.', origin: 'human' }],
  ['capability', CapabilityLevelSchema, { level: 'partial', note: 'gate observed, not enforced' }],
  ['config', ConfigSchema, DEFAULT_CONFIG],
];

describe('Every schema round-trips its example (parse(JSON.parse(JSON.stringify(x))) equals x)', () => {
  for (const [name, schema, x] of cases) {
    test(name, () => {
      expect(schema.parse(JSON.parse(JSON.stringify(x)))).toEqual(x);
    });
  }
});
