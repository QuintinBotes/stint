import { expect, test } from 'bun:test';
import * as mod from '../src/index';

test('@stint-dev/cli loads', () => {
  expect(mod).toBeDefined();
});
