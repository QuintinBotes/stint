import { describe, expect, test } from 'bun:test';
import {
  HandoffSchema,
  MetricsSchema,
  OutcomeSchema,
  PlanSchema,
  QuestionsSchema,
  ReviewSchema,
  SkillFrontmatterSchema,
  SkillProposalSchema,
  StintEventSchema,
  TaskSchema,
} from '../src/index';
import { example, makeAjv } from './ajv';

// The kit's JSON Schemas are the contract; the zod schemas are hand-written mirrors. This proves
// they agree: every example, and every mutation of every field, gets the same verdict from both.
const valid = makeAjv();

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Mutation = { label: string; value: Json };

const DELETE = Symbol('delete');

function mutationsAt(value: Json): Array<{ name: string; next: Json | typeof DELETE }> {
  const out: Array<{ name: string; next: Json | typeof DELETE }> = [
    { name: 'delete', next: DELETE },
    { name: 'null', next: null },
    { name: 'number', next: 12345 },
    { name: 'negative', next: -1 },
    { name: 'fraction', next: 1.5 },
    { name: 'empty string', next: '' },
    { name: 'long string', next: 'x'.repeat(4001) },
    { name: 'string of 201', next: 'y'.repeat(201) },
    { name: 'string of 401', next: 'z'.repeat(401) },
    { name: 'array', next: [] },
    { name: 'object', next: {} },
    { name: 'bad date', next: '2026-13-40T99:00:00Z' },
  ];
  if (Array.isArray(value)) out.push({ name: 'too many items', next: Array.from({ length: 60 }, () => value[0] ?? 'a') });
  if (value && typeof value === 'object' && !Array.isArray(value)) out.push({ name: 'unknown key', next: { ...value, zzUnknown: 1 } });
  return out;
}

function* walk(root: Json, path: Array<string | number> = []): Generator<{ path: Array<string | number>; mutation: Mutation }> {
  const here = get(root, path);
  if (path.length > 0) {
    for (const m of mutationsAt(here)) {
      yield { path, mutation: { label: `${path.join('.')} -> ${m.name}`, value: set(root, path, m.next) } };
    }
  }
  if (Array.isArray(here)) {
    for (let i = 0; i < here.length; i++) yield* walk(root, [...path, i]);
  } else if (here && typeof here === 'object') {
    for (const k of Object.keys(here)) yield* walk(root, [...path, k]);
  }
}

function get(root: Json, path: Array<string | number>): Json {
  return path.reduce<Json>((v, k) => (v as Record<string | number, Json>)[k] as Json, root);
}

function set(root: Json, path: Array<string | number>, next: Json | typeof DELETE): Json {
  const copy = structuredClone(root);
  const parent = get(copy, path.slice(0, -1)) as Record<string | number, Json> | Json[];
  const key = path[path.length - 1] as string | number;
  if (next === DELETE) {
    if (Array.isArray(parent)) parent.splice(key as number, 1);
    else delete parent[key];
  } else {
    (parent as Record<string | number, Json>)[key] = next;
  }
  return copy;
}

const cases = [
  { name: 'handoff', schema: HandoffSchema, examples: ['handoff-completed', 'handoff-killed', 'handoff-capped'] },
  { name: 'task', schema: TaskSchema, examples: ['task', 'task-limits'] },
  { name: 'event', schema: StintEventSchema, examples: ['event'] },
  { name: 'plan', schema: PlanSchema, examples: ['plan'] },
  { name: 'review', schema: ReviewSchema, examples: ['review'] },
  { name: 'skill-proposal', schema: SkillProposalSchema, examples: ['skill-proposal'] },
  { name: 'metrics', schema: MetricsSchema, examples: ['metrics'] },
  { name: 'outcome', schema: OutcomeSchema, examples: ['outcome'] },
  { name: 'skill', schema: SkillFrontmatterSchema, examples: ['skill'] },
  { name: 'questions', schema: QuestionsSchema, examples: ['questions'] },
] as const;

describe('zod schemas agree with the kit JSON Schemas on every example and every field mutation', () => {
  for (const c of cases) {
    for (const ex of c.examples) {
      test(`${c.name}: ${ex}`, () => {
        const root = example(ex) as Json;
        expect(valid(c.name, root)).toBe(true);
        expect(c.schema.safeParse(root).success).toBe(true);
        const disagreements: string[] = [];
        let count = 0;
        for (const { mutation } of walk(root)) {
          count++;
          const ajv = valid(c.name, mutation.value);
          const zod = c.schema.safeParse(mutation.value).success;
          if (ajv !== zod) disagreements.push(`${mutation.label}: ajv ${ajv}, zod ${zod}`);
        }
        expect(count).toBeGreaterThan(50);
        expect(disagreements).toEqual([]);
      });
    }
  }
});
