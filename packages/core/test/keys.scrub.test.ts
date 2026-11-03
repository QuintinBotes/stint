import { expect, test } from 'bun:test';
import { scrubDeep, scrubSecrets } from '../src/keys';

// assembled at run time so the secret scan does not read them as real keys
const fake = (...parts: string[]) => parts.join('');
const PEM = fake('-----BEGIN ', 'RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END ', 'RSA PRIVATE KEY-----');

test('a credential is redacted by its shape, whatever it is called', () => {
  expect(scrubSecrets(fake('curl -H "Authorization: Bearer ', 'eyJhbGciOiJIUzI1NiJ9', '" x'))).toBe('curl -H "Authorization: [redacted]" x');
  expect(scrubSecrets(fake('{"Authorization": "Basic ', 'dXNlcjpwYXNzd29yZA==', '"}'))).toBe('{"Authorization": "[redacted]"}');
  expect(scrubSecrets(fake('it sent Bearer ', 'abcDEF', '123456', 'ghiJKL', ' then'))).toBe('it sent Bearer [redacted] then');
  expect(scrubSecrets(fake('using s', 'k-', 'proj-Ab12', 'Cd34Ef56', 'Gh78Ij90Kl', ' now'))).toBe('using [redacted] now');
  expect(scrubSecrets(fake('push with gh', 'p_', 'R8k2Lm4Np6Qr8St0Uv2Wx4Yz6Ab8Cd0Ef2Gh'))).toBe('push with [redacted]');
  expect(scrubSecrets(fake('id AK', 'IA', 'Z7Q4N2V8K5T3R6W9'))).toBe('id [redacted]');
  expect(scrubSecrets(fake('hf_', 'Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz1Xc3Vb'))).toBe('[redacted]');
  expect(scrubSecrets(fake('xox', 'b-', '1234567890-abcdefghij'))).toBe('[redacted]');
  expect(scrubSecrets(`before\n${PEM}\nafter`)).toBe('before\n[redacted private key]\nafter');
});

test('ordinary text and code that name a credential keep their words', () => {
  for (const text of [
    'maxTokens: 30000',
    'headers: { Authorization: `Bearer ${d.token}` }',
    'Basic authentication is off',
    'the bearer of bad news',
    'sk-test-0123456789',
    'a sha like 4e32845f0a9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d',
  ]) expect(scrubSecrets(text)).toBe(text);
});

test('every string in a nested value is scrubbed and its shape is kept', () => {
  const token = fake('gh', 'p_', 'R8k2Lm4Np6Qr8St0Uv2Wx4Yz6Ab8Cd0Ef2Gh');
  expect(scrubDeep({ a: [`x ${token}`, 3], b: { c: token, d: null } })).toEqual({ a: ['x [redacted]', 3], b: { c: '[redacted]', d: null } });
});
