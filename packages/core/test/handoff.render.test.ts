import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  test('R-002 Req 7: docs/packet.md shows the killed example exactly as renderHandoff prints it, with its token count and size', () => {
    const doc = readFileSync(join(import.meta.dir, '..', '..', '..', 'docs', 'packet.md'), 'utf8');
    const section = doc.slice(doc.indexOf('## The killed example, as the next agent reads it'));
    // the fence opens after a newline and closes on its own line, so the block keeps the render's last newline
    const shown = /```\n([\s\S]*?)```/.exec(section)?.[1];
    const text = renderHandoff(examples[1] as Handoff);
    expect(shown).toBe(text);
    expect(section).toContain(`This is \`handoff-killed.json\` rendered: ${countTokens(text)} tokens, ${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB.`);
  });
});
