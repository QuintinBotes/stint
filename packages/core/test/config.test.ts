import { expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '../src/index';
test('The default chains try local models first for review and summary, and last for building', () => {
  const local = (e: string) => e.startsWith('ollama/');
  expect(local(DEFAULT_CONFIG.routes.reviewer[0] as string)).toBe(true);
  expect(local(DEFAULT_CONFIG.routes.summary[0] as string)).toBe(true);
  const agent = DEFAULT_CONFIG.routes.agent ?? [];
  expect(agent.findIndex(local)).toBe(agent.length - 1);
  expect(agent[0]).toBe('meta-api/muse-spark-1.3');
});
