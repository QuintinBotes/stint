import { expect, test } from 'bun:test';
import * as mod from '../src/index';

test('@stint-dev/adapter-muse-code loads', () => {
  expect(mod).toBeDefined();
});
