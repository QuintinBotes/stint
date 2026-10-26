import { expect, test } from 'bun:test';
import * as mod from '../src/index';

test('@stint-dev/adapter-claude-code loads', () => {
  expect(mod).toBeDefined();
});
