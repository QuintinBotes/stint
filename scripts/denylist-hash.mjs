#!/usr/bin/env node
// denylist-hash: one line for scripts/guard-identity.denylist.hmac, from a name read on stdin.
// Usage: printf %s '<name>' | node scripts/denylist-hash.mjs [--label <label>] >> scripts/guard-identity.denylist.hmac
// The name is read from stdin only, never taken as an argument, so it stays out of shell history.
// The label is printed beside the hash; it must not contain the name ("client 1", not the client).
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const key = process.env.STINT_GUARD_KEY ?? '';
if (!key) {
  process.stderr.write('denylist-hash: STINT_GUARD_KEY is not set; set it in .env or the shell, the same key CI holds as a secret\n');
  process.exit(1);
}
const args = process.argv.slice(2);
const labelAt = args.indexOf('--label');
const label = labelAt >= 0 ? args[labelAt + 1] : undefined;
if (labelAt >= 0 && !label) {
  process.stderr.write('denylist-hash: --label needs a value, for example --label "client 1"\n');
  process.exit(2);
}
if (args.some((a, i) => a !== '--label' && i !== labelAt + 1)) {
  process.stderr.write('denylist-hash: the name is read from stdin, never from an argument: printf %s <name> | node scripts/denylist-hash.mjs\n');
  process.exit(2);
}

// the same normalisation as the guard: NFKC, lowercase, tokens of letters and digits joined by one space
const name = readFileSync(0, 'utf8').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
if (!name) {
  process.stderr.write('denylist-hash: no name on stdin\n');
  process.exit(2);
}
if (label && name.split(' ').some((t) => label.normalize('NFKC').toLowerCase().includes(t))) {
  process.stderr.write('denylist-hash: the label contains the name; use a label like "client 1"\n');
  process.exit(2);
}
const hex = createHmac('sha256', key).update(name, 'utf8').digest('hex');
process.stdout.write(label ? `${hex}  # ${label}\n` : `${hex}\n`);
