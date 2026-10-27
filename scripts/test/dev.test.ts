import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');

// Running the loop here would start a daemon in the checkout and write .stint/ into it, which tests never do
// (SPEC-000), so the wiring is checked instead: the scripts, the watch flag, the proxy and the token in dev.
test('bun run dev runs the daemon under bun --watch beside vite, which proxies to it and reads its token; bun run demo is the replay', () => {
  const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
  expect(scripts.dev).toBe('bash scripts/dev.sh');
  expect(scripts.demo).toContain('stint demo');
  const dev = readFileSync(join(root, 'scripts', 'dev.sh'), 'utf8');
  expect(dev).toMatch(/bun --watch packages\/cli\/bin\/stint up --port "\$port"/);
  expect(dev).toMatch(/STINT_DAEMON="http:\/\/127\.0\.0\.1:\$\{port\}" bun run --cwd apps\/web dev/);
  const vite = readFileSync(join(root, 'apps', 'web', 'vite.config.ts'), 'utf8');
  expect(vite).toContain("process.env.STINT_DAEMON");
  expect(vite).toContain("'stint-dev-token'");
  expect(readFileSync(join(root, 'scripts', 'bootstrap.sh'), 'utf8')).toContain('exec bun run demo');
});
