import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = join(import.meta.dir, '..', 'bin', 'stint');

/** A PATH with `stint`, `claude` and `codex` stand-ins that write down how they were called, and nothing else. */
function fakes() {
  const dir = mkdtempSync(join(tmpdir(), 'stint-mcp-install-'));
  const path = join(dir, 'bin');
  mkdirSync(path);
  for (const name of ['stint', 'claude', 'codex']) writeFileSync(join(path, name), `#!/bin/sh\necho "$*" >> "${join(dir, `${name}.log`)}"\n`, { mode: 0o755 });
  const repo = join(dir, 'my repo');
  mkdirSync(repo);
  const stint = (...args: string[]) => Bun.spawnSync([process.execPath, bin, 'mcp', 'install', ...args, '--repo', repo], { stdout: 'pipe', stderr: 'pipe', env: { PATH: path, HOME: dir } });
  const log = (name: string) => (existsSync(join(dir, `${name}.log`)) ? readFileSync(join(dir, `${name}.log`), 'utf8') : null);
  return { repo, stint, log };
}

test('R-069 Acceptance 3: stint mcp install claude --print and codex --print print the exact commands and run nothing', () => {
  const f = fakes();
  const claude = f.stint('claude', '--print');
  expect(claude.exitCode).toBe(0);
  expect(claude.stdout.toString()).toBe(`claude mcp add stint -- stint mcp --repo '${f.repo}'\n`);
  const codex = f.stint('codex', '--print');
  expect(codex.exitCode).toBe(0);
  expect(codex.stdout.toString()).toBe(`codex mcp add stint -- stint mcp --repo '${f.repo}'\n`);
  expect([f.log('claude'), f.log('codex')]).toEqual([null, null]);
});

test('R-069 Requirement 6: stint mcp install runs each tool\'s own mcp add and says what changed; another client is refused', () => {
  const f = fakes();
  const claude = f.stint('claude');
  expect(claude.exitCode).toBe(0);
  expect(f.log('claude')).toBe(`mcp add stint -- stint mcp --repo ${f.repo}\n`);
  expect(claude.stdout.toString()).toContain(`Claude Code starts Stint's MCP server for ${f.repo} when you open it in that folder (its local scope).`);
  const codex = f.stint('codex');
  expect(codex.exitCode).toBe(0);
  expect(f.log('codex')).toBe(`mcp add stint -- stint mcp --repo ${f.repo}\n`);
  expect(codex.stdout.toString()).toContain('[mcp_servers.stint] in ~/.codex/config.toml');
  const other = f.stint('gemini');
  expect(other.exitCode).toBe(2);
  expect(other.stderr.toString()).toBe('stint mcp install takes claude or codex, not gemini\n');
  expect(f.log('stint')).toBeNull();
});

test('stint mcp install ends without reading stdin, so it does not also start the server', async () => {
  const p = Bun.spawn([process.execPath, bin, 'mcp', 'install', 'claude', '--print', '--repo', tmpdir()], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const ended = await Promise.race([p.exited.then(() => 'ended'), Bun.sleep(5000).then(() => 'waiting on stdin')]);
  p.kill();
  expect(ended).toBe('ended');
});
