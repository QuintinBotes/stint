import { expect, test } from 'bun:test';
import { bindAddress, bindWarning } from '../src/bind';

test('--bind takes an IP address and refuses a name', () => {
  expect(bindAddress('127.0.0.1')).toBe('127.0.0.1');
  expect(bindAddress('0.0.0.0')).toBe('0.0.0.0');
  expect(bindAddress('::')).toBe('::');
  expect(() => bindAddress('example.com')).toThrow('--bind takes an IP address such as 127.0.0.1 or 0.0.0.0, not example.com');
  expect(() => bindAddress('')).toThrow('--bind takes an IP address');
});

test('only an address beyond loopback prints the warning', () => {
  expect(bindWarning('127.0.0.1')).toBeNull();
  expect(bindWarning('::1')).toBeNull();
  expect(bindWarning('0.0.0.0')).toBe('The daemon listens on 0.0.0.0, beyond loopback. Publish its port on 127.0.0.1 only; docs/docker.md says why.');
});
