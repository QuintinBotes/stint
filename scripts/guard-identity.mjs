#!/usr/bin/env node
// guard-identity: fail on anything that identifies the author beyond the GitHub handle.
// Usage: node scripts/guard-identity.mjs [path] [--commits <range>]   exit 0 clean, 1 findings
// Rules: real email addresses (noreply@ and example.com allowed), em and en dashes in text files, the words in
// scripts/guard-identity.denylist (gitignored, one per line), and the names in scripts/guard-identity.denylist.hmac
// (committed, keyed HMAC-SHA256 hashes; the key is STINT_GUARD_KEY, so the file reveals nothing without it).
// --commits runs the same rules over the commit messages in a git range instead of over files.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const args = process.argv.slice(2);
const commitsAt = args.indexOf('--commits');
const commitRange = commitsAt >= 0 ? args[commitsAt + 1] : undefined;
if (commitsAt >= 0 && !commitRange) {
  process.stderr.write('guard-identity: --commits needs a range, for example origin/main..HEAD\n');
  process.exit(2);
}
const positional = commitsAt < 0 ? args : args.filter((_, i) => i !== commitsAt && i !== commitsAt + 1);
const target = resolve(positional[0] ?? repoRoot);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const DASH_EXT = /\.(md|ts|tsx|mjs|js|json|jsonl|sh|yml|yaml|css|html)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.tsbuild', '.stint', 'playwright-report', 'test-results']);
// specs/ is the frozen build kit and the guard's own test quotes it: both name the sample address.
const EMAIL_EXEMPT = /^(specs\/|scripts\/test\/guard-identity\.test\.ts$)/;
// bench runs and live recordings hold model output verbatim; its dashes are the models' words, not ours. Names and emails are still checked.
const DASH_EXEMPT = /^(bench\/runs|bench\/digest\/runs|bench\/golden-runs|demo\/recordings)\/|^packages\/adapters\/[\w-]+\/test\/fixtures\/[\w.-]+\.recorded\.jsonl$/;
const KEYED_LIST = join(here, 'guard-identity.denylist.hmac');

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

/** The keyed list: one lowercase hex HMAC-SHA256 per line, optionally followed by `# <label>`. Entry n is the nth hash. */
function loadKeyedList() {
  if (!existsSync(KEYED_LIST)) return [];
  return readFileSync(KEYED_LIST, 'utf8')
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim().toLowerCase())
    .filter((l) => /^[0-9a-f]{64}$/.test(l));
}

/** NFKC, lowercase, then tokens of letters and digits; everything else separates them. */
function tokens(text) {
  return text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Every candidate a name can hide as: each token, and each adjacent pair joined by a space and by nothing. */
function candidates(text) {
  const t = tokens(text);
  const out = new Set(t);
  for (let i = 0; i + 1 < t.length; i++) {
    out.add(`${t[i]} ${t[i + 1]}`);
    out.add(`${t[i]}${t[i + 1]}`);
  }
  return out;
}

const hmac = (key, value) => createHmac('sha256', key).update(value, 'utf8').digest('hex');

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
const keyed = loadKeyedList();
const key = process.env.STINT_GUARD_KEY ?? '';
const keyedEntries = key ? new Map(keyed.map((h, i) => [h, i + 1])) : new Map();

// In CI a guard that cannot check names is a failure, not a warning (fail open loudly, non-negotiable 6).
if (process.env.CI === 'true' && (!key || keyed.length === 0)) {
  process.stderr.write(
    !key
      ? 'guard-identity: STINT_GUARD_KEY is not set, so names cannot be checked; set the repository secret\n'
      : 'guard-identity: scripts/guard-identity.denylist.hmac has no entries, so names cannot be checked\n',
  );
  process.exit(1);
}

/** The rules over one line of text; `at` says where it came from. Names are reported by entry, never echoed. */
function checkLine(line, at, { email = true, dash = true } = {}) {
  const found = [];
  if (email) {
    for (const m of line.matchAll(EMAIL)) {
      if (!allowedEmail(m[0])) found.push(`${at}: email address ${m[0]}`);
    }
  }
  if (dash && DASH.test(line)) found.push(`${at}: em or en dash`);
  for (const { word, re } of denylist) {
    if (re.test(line)) found.push(`${at}: denylisted word "${word}"`);
  }
  if (keyedEntries.size > 0) {
    const hits = new Set();
    for (const c of candidates(line)) {
      const n = keyedEntries.get(hmac(key, c));
      if (n !== undefined) hits.add(n);
    }
    for (const n of [...hits].sort((a, b) => a - b)) found.push(`${at}: denylisted name (entry ${n})`);
  }
  return found;
}

const findings = [];

if (commitRange) {
  // %H, a NUL, the message, then a separator no message holds
  let log = '';
  try {
    log = execFileSync('git', ['-C', target, 'log', '--format=%H%x00%B%x1e', commitRange], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    process.stderr.write(`guard-identity: git log ${commitRange} failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}\n`);
    process.exit(2);
  }
  for (const record of log.split('\x1e')) {
    const [sha, message] = record.replace(/^\n/, '').split('\0');
    if (!sha || message === undefined) continue;
    const seen = new Set();
    for (const line of message.split('\n')) {
      for (const f of checkLine(line, sha.slice(0, 12))) {
        if (!seen.has(f)) findings.push(f);
        seen.add(f);
      }
    }
  }
} else {
  const files = statSync(target).isFile() ? [target] : listFiles(target);
  for (const file of files) {
    if (!existsSync(file) || file.endsWith('guard-identity.denylist') || file === KEYED_LIST) continue;
    const buf = readFileSync(file);
    if (buf.includes(0)) continue; // binary
    const rel = relative(repoRoot, file);
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      findings.push(...checkLine(line, `${rel}:${i + 1}`, { email: !EMAIL_EXEMPT.test(rel), dash: DASH_EXT.test(file) && !DASH_EXEMPT.test(rel) }));
    });
  }
}

if (findings.length > 0) {
  for (const f of findings) process.stdout.write(`${f}\n`);
  process.stderr.write(`guard-identity: ${findings.length} finding(s)\n`);
  process.exit(1);
}
if (denylist.length === 0 && keyedEntries.size === 0) {
  process.stderr.write(
    key
      ? 'guard-identity: scripts/guard-identity.denylist.hmac has no entries and there is no scripts/guard-identity.denylist, so names were NOT checked\n'
      : 'guard-identity: no STINT_GUARD_KEY and no scripts/guard-identity.denylist, so names were NOT checked\n',
  );
}
process.exit(0);
