import { describe, expect, test } from 'bun:test';
import { HANDOFF_PREAMBLE, type Handoff, HEADINGS, countTokens, parseHandoffPrompt, renderHandoff } from '../src/index';
import { example } from './ajv';

const examples = ['completed', 'killed', 'capped'].map((n) => example(`handoff-${n}`) as Handoff);
const withRefusals: Handoff = {
  ...(examples[1] as Handoff),
  refusals: [
    { action: 'git push origin stint/T-0042', by: 'stint-rules', reason: 'pushing is the human\'s call' },
    { action: 'rm -rf node_modules', by: 'runtime', carriedFrom: 'muse-code r2' },
  ],
};

describe('renderHandoff of each example is under 600 tokens and parseHandoffPrompt(renderHandoff(x)) returns x\'s task, refusals and leftOut', () => {
  for (const x of [...examples, withRefusals]) {
    test(`${x.task} ${x.from.endedBy}${x.refusals?.length ? ' with refusals' : ''}`, () => {
      const text = renderHandoff(x);
      expect(countTokens(text)).toBeLessThan(600);
      const back = parseHandoffPrompt(text);
      expect(back.task).toBe(x.task);
      expect(back.refusals).toEqual(x.refusals ?? []);
      expect(back.notIncluded).toEqual(x.leftOut);
      expect(back.whereItGotTo).toContain(`The run ended: ${x.from.endedBy}.`);
    });
  }

  test('the prompt opens with the preamble and carries every heading in order', () => {
    const text = renderHandoff(examples[1] as Handoff);
    expect(text.startsWith(HANDOFF_PREAMBLE)).toBe(true);
    const positions = Object.values(HEADINGS).map((h) => text.indexOf(`\n${h}\n`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test('the killed demo packet renders to 412 tokens and about 1.4 KB', () => {
    const text = renderHandoff(examples[1] as Handoff);
    expect(countTokens(text)).toBe(412);
    expect((new TextEncoder().encode(text).length / 1024).toFixed(1)).toBe('1.4');
  });
});
