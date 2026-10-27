#!/usr/bin/env node
// guard-identity: fail on anything that identifies the author beyond the GitHub handle.
// Usage: node scripts/guard-identity.mjs [path]   exit 0 clean, 1 findings (file:line: reason)
// Rules: real email addresses (noreply@ and example.com allowed), em and en dashes in text
// files, and any word in scripts/guard-identity.denylist (gitignored, one entry per line).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const target = resolve(process.argv[2] ?? repoRoot);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const DASH_EXT = /\.(md|ts|tsx|mjs|js|json|jsonl|sh|yml|yaml|css|html)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.tsbuild', '.stint', 'playwright-report', 'test-results']);
// specs/ is the frozen build kit and the guard's own test quotes it: both name the sample address.
const EMAIL_EXEMPT = /^(specs\/|scripts\/test\/guard-identity\.test\.ts$)/;
// bench runs and live recordings hold model output verbatim; its dashes are the models' words, not ours. Names and emails are still checked.
const DASH_EXEMPT = /^(bench\/runs|bench\/digest\/runs|bench\/golden-runs|demo\/recordings)\//;

function allowedEmail(addr) {
  const lower = addr.toLowerCase();
  return (
    lower.includes('noreply@') ||
    lower.endsWith('@users.noreply.github.com') ||
    /@([a-z0-9-]+\.)*example\.com$/.test(lower)
  );
}

function loadDenylist() {
  const file = join(here, 'guard-identity.denylist');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((word) => ({ word, re: new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') }));
}

function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    if (resolve(top) === root) return out.split('\0').filter(Boolean).map((f) => join(root, f));
  } catch {
    // not a git checkout of its own: walk it
  }
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) files.push(full);
    }
  };
  walk(root);
  return files;
}

const denylist = loadDenylist();
const findings = [];
const files = statSync(target).isFile() ? [target] : listFiles(target);

for (const file of files) {
  if (!existsSync(file) || file.endsWith('guard-identity.denylist')) continue;
  const buf = readFileSync(file);
  if (buf.includes(0)) continue; // binary
  const rel = relative(repoRoot, file);
  const lines = buf.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (!EMAIL_EXEMPT.test(rel)) {
      for (const m of line.matchAll(EMAIL)) {
        if (!allowedEmail(m[0])) findings.push(`${at}: email address ${m[0]}`);
      }
    }
    if (DASH_EXT.test(file) && !DASH_EXEMPT.test(rel) && DASH.test(line)) findings.push(`${at}: em or en dash`);
    for (const { word, re } of denylist) {
      if (re.test(line)) findings.push(`${at}: denylisted word "${word}"`);
    }
  });
}

if (findings.length > 0) {
  for (const f of findings) process.stdout.write(`${f}\n`);
  process.stderr.write(`guard-identity: ${findings.length} finding(s)\n`);
  process.exit(1);
}
if (denylist.length === 0) {
  process.stderr.write('guard-identity: no scripts/guard-identity.denylist, so names were NOT checked\n');
}
process.exit(0);
