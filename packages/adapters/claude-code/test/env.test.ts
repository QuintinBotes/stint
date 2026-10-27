import { expect, test } from 'bun:test';
import { anthropicBase, hostEnv } from '../src/index';

test("Claude Code on a configured host gets that host's address; a keyless local host also gets a placeholder token; the person's own values win", () => {
  expect(anthropicBase('http://localhost:11434/v1')).toBe('http://localhost:11434');
  expect(anthropicBase('https://gateway.example/v1/')).toBe('https://gateway.example');

  const ollama = { id: 'ollama', baseURL: 'http://localhost:11434/v1', keyless: true };
  expect(hostEnv({ PATH: '/bin' }, ollama)).toEqual({ PATH: '/bin', ANTHROPIC_BASE_URL: 'http://localhost:11434', ANTHROPIC_AUTH_TOKEN: 'ollama' });
  expect(hostEnv({ ANTHROPIC_BASE_URL: 'http://elsewhere:1', ANTHROPIC_AUTH_TOKEN: 't' }, ollama)).toEqual({ ANTHROPIC_BASE_URL: 'http://elsewhere:1', ANTHROPIC_AUTH_TOKEN: 't' });

  // a keyed host's credential is never invented or copied here; the person passes it through the preset's env
  const gateway = { id: 'litellm', baseURL: 'https://gateway.example/v1', keyless: false };
  expect(hostEnv({}, gateway)).toEqual({ ANTHROPIC_BASE_URL: 'https://gateway.example' });
  expect(hostEnv({ PATH: '/bin' })).toEqual({ PATH: '/bin' });
});
