import { expect, test } from 'bun:test';
import { hostMark, hostName } from '../src/agents';

test('An agent that bills to its own account is named and inked as that agent, not as Meta', () => {
  expect(hostName('claude-code')).toBe('Claude Code');
  expect(hostMark('claude-code')).toBe('anthropic');
  expect(hostMark('codex')).toBe('openai');
  expect(hostName('meta-api')).toBe('Meta Model API');
  expect(hostMark('fireworks')).toBe('meta');
  expect(hostMark('ollama')).toBe('local');
});
