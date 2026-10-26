import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const guard = join(import.meta.dir, '..', 'guard-identity.mjs');
const run = (path?: string) =>
  Bun.spawnSync(['node', guard, ...(path ? [path] : [])], { stdout: 'pipe', stderr: 'pipe' });

function fixture(name: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  writeFileSync(join(dir, name), text);
  return dir;
}

describe('guard-identity', () => {
  test('node scripts/guard-identity.mjs exits 0 on the repo', () => {
    const r = run();
    expect(r.stdout.toString()).toBe('');
    expect(r.exitCode).toBe(0);
  });

  test('exits 1 on a fixture file containing someone at gmail.com', () => {
    const r = run(fixture('notes.md', `contact: ${'someone'}@${'gmail.com'}\n`));
    expect(r.exitCode).toBe(1);
    expect(r.stdout.toString()).toContain('notes.md:1: email address');
  });

  test('allows noreply and example.com addresses', () => {
    const r = run(fixture('ok.md', `${'demo'}@${'example.com'} and 1+handle@users.${'noreply'}.github.com\n`));
    expect(r.exitCode).toBe(0);
  });

  test('fails on an em dash in a markdown file', () => {
    const r = run(fixture('dash.md', `one ${String.fromCharCode(0x2014)} two\n`));
    expect(r.exitCode).toBe(1);
    expect(r.stdout.toString()).toContain('em or en dash');
  });
});
