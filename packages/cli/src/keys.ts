import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyKeys, knownKeyNames, loadKeys, userKeyFile, writeFileAtomic } from '@stint-dev/core/node';
import { defineCommand } from 'citty';
import { repoRoot } from './repo';

/** The environment as the shell gave it, before Stint loads any key into it, so a report names each key's real source. */
const STARTUP_ENV: NodeJS.ProcessEnv = { ...process.env };

/** Where each known key comes from for this repository, as the person's shell and files have it. */
export function keyReport(root: string): ReturnType<typeof loadKeys> {
  return loadKeys(root, { env: STARTUP_ENV });
}

/** Loads the keys for the repository the command runs in, once, before any command needs one. */
export function applyStartupKeys(): void {
  try {
    applyKeys(repoRoot());
  } catch {
    // outside a repository there is nothing to load for; a command that needs a key says so itself
  }
}

/** A secret from stdin: typed with no echo at a terminal, or piped. */
async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return (await Bun.stdin.text()).replace(/\r?\n$/, '');
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  return new Promise((done) => {
    let value = '';
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.off('data', onData);
          process.stdin.pause();
          process.stderr.write('\n');
          done(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdin.setRawMode(false);
          process.exit(130);
        }
        value = ch === '\u007f' ? value.slice(0, -1) : value + ch;
      }
    };
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

const set = defineCommand({
  meta: { name: 'set', description: 'Save a key to your user-level key file (mode 0600), read from stdin with no echo' },
  args: {
    name: { type: 'positional', required: true, description: 'The key name, for example META_API_KEY' },
    repo: { type: 'string', description: 'Repository whose config names extra keys (default: the git top level)' },
  },
  async run({ args }) {
    const known = knownKeyNames(repoRoot(args.repo));
    if (!known.includes(args.name)) {
      process.stderr.write(`${args.name} is not a key Stint reads. Known keys: ${known.join(', ')}\n`);
      process.exit(2);
    }
    const value = (await readSecret(`Value for ${args.name} (not shown): `)).trim();
    if (!value) {
      process.stderr.write('No value given; nothing was saved.\n');
      process.exit(2);
    }
    const file = userKeyFile();
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    let lines: string[] = [];
    try {
      lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
    } catch {
      // the first key creates the file
    }
    const line = `${args.name}=${value}`;
    const at = lines.findIndex((l) => l.replace(/^export\s+/, '').startsWith(`${args.name}=`));
    if (at >= 0) lines[at] = line;
    else lines.push(line);
    await writeFileAtomic(file, `${lines.join('\n')}\n`, { mode: 0o600 });
    process.stdout.write(`Saved ${args.name} to ${file}. Every repository you run stint in can use it.\n`);
  },
});

const list = defineCommand({
  meta: { name: 'list', description: 'Each key Stint reads, where it comes from, and whether it is set; never a value' },
  args: {
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    json: { type: 'boolean', description: 'Machine-readable output' },
  },
  run({ args }) {
    const { sources, refusals } = keyReport(repoRoot(args.repo));
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ keys: Object.entries(sources).map(([name, source]) => ({ name, source, set: source !== 'missing' })), refusals })}\n`);
      return;
    }
    const where = { env: 'the environment', repo: "this repository's .env", user: userKeyFile(), checkout: "the Stint checkout's .env (move it)", missing: 'not set' } as const;
    for (const [name, source] of Object.entries(sources)) process.stdout.write(`${name.padEnd(22)} ${where[source]}\n`);
  },
});

export const keys = defineCommand({
  meta: { name: 'keys', description: 'Where Stint finds your keys, and saving one so every repository can use it' },
  subCommands: { set, list },
});
