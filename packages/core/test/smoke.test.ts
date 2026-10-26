import { expect, test } from 'bun:test';
import * as mod from '../src/index';

test('@stint-dev/core loads', () => {
  expect(mod).toBeDefined();
});
