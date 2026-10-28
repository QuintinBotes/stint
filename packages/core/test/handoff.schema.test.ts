import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { HandoffSchema, formatIssues } from '../src/index';
import { hashHandoff } from '../src/node';
import { example, kitSchema, makeAjv, readJson } from './ajv';

const valid = makeAjv();
const killed = example('handoff-killed') as Record<string, unknown>;
const stripId = (s: Record<string, unknown>) => {
  const { $id: _id, ...rest } = s;
  return rest;
};

describe('The three handoff examples validate with Ajv against schemas/handoff.schema.json and the emitted file equals the kit\'s', () => {
  for (const name of ['completed', 'killed', 'capped']) {
    test(`handoff-${name}.json validates with Ajv and zod, and its hash is the canonical hash`, () => {
      const x = example(`handoff-${name}`) as Record<string, unknown>;
      expect(valid('handoff', x)).toBe(true);
      const parsed = HandoffSchema.parse(x);
      expect(parsed.hash).toBe(hashHandoff(parsed));
    });
  }

  test('packages/core/schemas/handoff.schema.json equals schemas/handoff.schema.json (ignoring $id)', () => {
    for (const name of ['handoff', 'task', 'event', 'plan', 'review', 'skill', 'skill-proposal', 'questions']) {
      const emitted = readJson(join(import.meta.dir, '..', 'schemas', `${name}.schema.json`)) as Record<string, unknown>;
      expect(stripId(emitted)).toEqual(stripId(kitSchema(name)));
    }
  });
});

describe('A packet with summary of 401 chars, or missing leftOut, or empty askOfNext, is rejected with a message naming the field', () => {
  const reject = (packet: unknown, field: string) => {
    const r = HandoffSchema.safeParse(packet);
    expect(r.success).toBe(false);
    if (!r.success) expect(formatIssues(r.error)).toContain(`${field}:`);
    expect(valid('handoff', packet)).toBe(false);
  };

  test('summary of 401 chars', () => reject({ ...killed, summary: 'x'.repeat(401) }, 'summary'));

  test('missing leftOut', () => {
    const { leftOut: _l, ...rest } = killed;
    reject(rest, 'leftOut');
  });

  test('empty askOfNext', () => reject({ ...killed, askOfNext: '' }, 'askOfNext'));

  test('an empty leftOut is valid: it must be present, it may be empty', () => {
    expect(HandoffSchema.safeParse({ ...killed, leftOut: [] }).success).toBe(true);
  });
});
