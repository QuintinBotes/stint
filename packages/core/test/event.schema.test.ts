import { describe, expect, test } from 'bun:test';
import { StintEventSchema, classifyEvent } from '../src/index';
import { example, makeAjv } from './ajv';

const valid = makeAjv();
const base = example('event') as Record<string, unknown>;

describe('An event with an unknown type is accepted only as runtime.unclassified with the original type in payload.originalType', () => {
  test('an unknown type is rejected as is', () => {
    const raw = { ...base, type: 'muse.compaction', payload: { tokens: 120000 } };
    expect(StintEventSchema.safeParse(raw).success).toBe(false);
    expect(valid('event', raw)).toBe(false);
  });

  test('classifyEvent keeps it as runtime.unclassified with payload.originalType', () => {
    const e = classifyEvent({ ...base, type: 'muse.compaction', payload: { tokens: 120000 } });
    expect(e.type).toBe('runtime.unclassified');
    expect(e.payload).toEqual({ tokens: 120000, originalType: 'muse.compaction' });
    expect(StintEventSchema.safeParse(e).success).toBe(true);
    expect(valid('event', e)).toBe(true);
  });

  test('runtime.unclassified without originalType is rejected', () => {
    const e = { ...base, type: 'runtime.unclassified', payload: { tokens: 1 } };
    expect(StintEventSchema.safeParse(e).success).toBe(false);
    expect(valid('event', e)).toBe(false);
  });

  test('a known type passes through classifyEvent unchanged', () => {
    expect(classifyEvent(base as { type: string; payload: Record<string, unknown> })).toEqual(base as never);
  });
});
