import { expect, test } from 'bun:test';
import * as mod from '../src/index';

test('@stint-dev/adapter-openai-compatible loads', () => {
  expect(mod).toBeDefined();
});
