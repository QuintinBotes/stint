import { expect, test } from 'bun:test';
import { App } from '../src/App';

test('@stint-dev/web exports the app shell', () => {
  expect(typeof App).toBe('function');
});
