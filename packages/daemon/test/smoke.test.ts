import { expect, test } from 'bun:test';
import * as mod from '../src/index';

test('@stint-dev/daemon loads', () => {
  expect(mod).toBeDefined();
});
