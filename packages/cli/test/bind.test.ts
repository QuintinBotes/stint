import { expect, test } from 'bun:test';
import { bindAddress, bindWarning } from '../src/bind';

test('--bind takes 127.0.0.1 or 0.0.0.0, the addresses that keep 127.0.0.1 reachable for every client', () => {
  expect(bindAddress('127.0.0.1')).toBe('127.0.0.1');
  expect(bindAddress('0.0.0.0')).toBe('0.0.0.0');
  for (const refused of ['::1', '::', '192.168.1.5', 'example.com', '']) {
    expect(() => bindAddress(refused)).toThrow(`--bind takes 127.0.0.1 or 0.0.0.0, not ${refused}: every client reaches the daemon on 127.0.0.1`);
  }
});

test('only 0.0.0.0 prints the warning', () => {
  expect(bindWarning('127.0.0.1')).toBeNull();
  expect(bindWarning('0.0.0.0')).toBe('The daemon listens on 0.0.0.0, beyond loopback. Publish its port on 127.0.0.1 only; docs/docker.md says why.');
});
