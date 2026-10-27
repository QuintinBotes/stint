import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scripts = join(import.meta.dir, '..');
const guard = join(scripts, 'guard-identity.mjs');
const hasher = join(scripts, 'denylist-hash.mjs');
// every run says which environment it means: CI and the key are set per test, never inherited
const baseEnv = () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'CI' && k !== 'STINT_GUARD_KEY') env[k] = v;
  return env;
};
const run = (path?: string) => Bun.spawnSync(['node', guard, ...(path ? [path] : [])], { stdout: 'pipe', stderr: 'pipe', env: baseEnv() });

function fixture(name: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  writeFileSync(join(dir, name), text);
  return dir;
}

const KEY = 'test-key-not-a-secret';
const entry = (name: string) => createHmac('sha256', KEY).update(name, 'utf8').digest('hex');

/** A copy of the guard in its own folder with its own keyed list, so the repository's list is never touched. */
function keyedGuard(entries: string[]): { dir: string; guard: string } {
  const dir = mkdtempSync(join(tmpdir(), 'guard-keyed-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(guard, join(dir, 'scripts', 'guard-identity.mjs'));
  writeFileSync(join(dir, 'scripts', 'guard-identity.denylist.hmac'), entries.map((e, i) => `${entry(e)}  # entry ${i + 1}\n`).join(''));
  return { dir, guard: join(dir, 'scripts', 'guard-identity.mjs') };
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

  test('R-058 Acceptance 1: with a keyed entry for acme, the guard flags Acme Corp, ACME, ac-me, and ac:me; it does not flag acmeist, and its stdout and stderr never contain acme in any case', () => {
    const { dir, guard: copy } = keyedGuard(['acme']);
    const files = join(dir, 'files');
    mkdirSync(files);
    const flagged = ['Acme Corp', 'ACME', 'ac-me', 'ac:me'];
    flagged.forEach((text, i) => writeFileSync(join(files, `f${i + 1}.md`), `before\nwe met ${text} today\n`));
    writeFileSync(join(files, 'clean.md'), 'an acmeist is not a name\n');
    const r = Bun.spawnSync(['node', copy, files], { stdout: 'pipe', stderr: 'pipe', env: { ...baseEnv(), STINT_GUARD_KEY: KEY } });
    const out = r.stdout.toString();
    const all = `${out}${r.stderr.toString()}`.toLowerCase();
    expect(r.exitCode).toBe(1);
    for (let i = 1; i <= flagged.length; i++) expect(out).toContain(`files/f${i}.md:2: denylisted name (entry 1)`);
    expect(out).not.toContain('clean.md');
    expect(all).not.toContain('acme');
  });

  test('R-058 Acceptance 2: --commits flags a commit message that contains Globex in a temporary repository with a keyed globex entry', () => {
    const { dir, guard: copy } = keyedGuard(['globex']);
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const git = (...a: string[]) => Bun.spawnSync(['git', '-C', repo, ...a], { stdout: 'pipe', stderr: 'pipe' });
    git('init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'Add a for the Globex work');
    const sha = git('rev-parse', 'HEAD').stdout.toString().trim();
    const r = Bun.spawnSync(['node', copy, repo, '--commits', 'HEAD'], { stdout: 'pipe', stderr: 'pipe', env: { ...baseEnv(), STINT_GUARD_KEY: KEY } });
    const out = r.stdout.toString();
    expect(r.exitCode).toBe(1);
    expect(out).toContain(`${sha.slice(0, 12)}: denylisted name (entry 1)`);
    expect(`${out}${r.stderr.toString()}`.toLowerCase()).not.toContain('globex');
  });

  test('R-058 Acceptance 3: with CI=true, a missing key, and no plain denylist, the guard exits 1 and names the missing variable', () => {
    const { guard: copy } = keyedGuard(['acme']);
    const r = Bun.spawnSync(['node', copy, fixture('ok.md', 'nothing here\n')], { stdout: 'pipe', stderr: 'pipe', env: { ...baseEnv(), CI: 'true' } });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain('STINT_GUARD_KEY');
    // and locally the same guard says names were not checked and passes
    const local = Bun.spawnSync(['node', copy, fixture('ok.md', 'nothing here\n')], { stdout: 'pipe', stderr: 'pipe', env: baseEnv() });
    expect(local.exitCode).toBe(0);
    expect(local.stderr.toString()).toContain('names were NOT checked');
  });

  test('denylist-hash reads the name from stdin only, refuses without the key, and prints the line the guard matches', () => {
    const hash = (stdin: string, args: string[], key?: string) =>
      Bun.spawnSync(['node', hasher, ...args], { stdin: Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe', env: { ...baseEnv(), ...(key ? { STINT_GUARD_KEY: key } : {}) } });
    const noKey = hash('globex', []);
    expect(noKey.exitCode).toBe(1);
    expect(noKey.stderr.toString()).toContain('STINT_GUARD_KEY');
    const asArgument = hash('', ['globex'], KEY);
    expect(asArgument.exitCode).toBe(2);
    expect(hash('  Globex ', [], KEY).stdout.toString()).toBe(`${entry('globex')}\n`);
    expect(hash('Globex Corp', ['--label', 'client 1'], KEY).stdout.toString()).toBe(`${entry('globex corp')}  # client 1\n`);
    expect(hash('globex', ['--label', 'globex work'], KEY).exitCode).toBe(2);
  });
});
