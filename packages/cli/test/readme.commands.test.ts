// Every shell block in README.md and docs/setup.md runs, or says why not (R-059 Requirement 8). A block preceded by
// `<!-- needs: X -->` is skipped with that reason printed. The rest run in order, in a temporary HOME, against a fresh
// copy of the fixture as "your repository", with the flow tests' fake agents and model server. Two lines are stood in
// for: `cd /path/to/your/repo` goes to that copy, and `stint up` (which runs until stopped) is the fake-agent daemon,
// started in this process. A ```text block right after a block that ran must match what it printed, ports, hashes and
// paths aside.
import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';
import { fakeAcp, flowConfig, startFakeModels, writer } from '../../../apps/web/e2e/flows/fakes';
import { tempDir, withFixtureRepo } from '../../core/test/fixture';
import { main } from '../src/main';

const checkout = join(import.meta.dir, '..', '..', '..');
const DOCS = ['README.md', 'docs/setup.md'];
const YOUR_REPO = /^cd \/path\/to\/your\/repo\s*$/;

type Block = { file: string; line: number; needs: string | null; text: string; output: string | null };

/** The shell blocks of a markdown file, each with its needs marker and the ```text block that follows it, if any. */
export function shellBlocks(file: string): Block[] {
  const lines = readFileSync(join(checkout, file), 'utf8').split('\n');
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(bash|sh|shell)\s*$/.exec(lines[i] as string);
    if (!open) continue;
    const start = i;
    const body: string[] = [];
    for (i++; i < lines.length && lines[i] !== '```'; i++) body.push(lines[i] as string);
    let prev = start - 1;
    while (prev >= 0 && (lines[prev] as string).trim() === '') prev--;
    const needs = /^<!-- needs: (.+) -->$/.exec((lines[prev] ?? '').trim())?.[1] ?? null;
    let next = i + 1;
    while (next < lines.length && (lines[next] as string).trim() === '') next++;
    let output: string | null = null;
    if (lines[next] === '```text') {
      const o: string[] = [];
      for (let j = next + 1; j < lines.length && lines[j] !== '```'; j++) o.push(lines[j] as string);
      output = o.join('\n');
    }
    out.push({ file, line: start + 1, needs, text: body.join('\n'), output });
  }
  return out;
}

const commands = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .flatMap((l) => l.split(/\s*&&\s*/));

/** Ports, hashes, temporary paths and timings change every run; the words around them must not. */
const normalise = (s: string) =>
  s
    .replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORT')
    .replace(/\b[0-9a-f]{7,40}\b/g, 'HASH')
    .replace(/\/(private\/)?(var|tmp)\/[^\s,)]+/g, 'PATH')
    .replace(/\b\d+(\.\d+)?\s?(ms|s)\b/g, 'TIME')
    .trim();

test('R-059 Acceptance 2: a command in a README or docs/setup.md block that the CLI does not have fails the test', () => {
  const known = new Set(Object.keys((main as { subCommands: Record<string, unknown> }).subCommands));
  const unknown: string[] = [];
  for (const file of DOCS) {
    for (const b of shellBlocks(file)) {
      for (const c of commands(b.text)) {
        const sub = /^stint\s+([a-z-]+)/.exec(c)?.[1];
        if (sub && !known.has(sub)) unknown.push(`${file}:${b.line}: stint ${sub}`);
      }
    }
  }
  expect(unknown).toEqual([]);
  // and the check itself catches a made-up command
  expect(known.has('teleport')).toBe(false);
});

test('R-059 Acceptance 2: every shell block in the README and docs/setup.md runs, or is skipped with its needs reason', async () => {
  const blocks = DOCS.flatMap(shellBlocks);
  expect(blocks.length).toBeGreaterThan(5);
  const home = tempDir('stint-readme-home-');
  const models = startFakeModels();
  let daemon: Awaited<ReturnType<typeof startDaemon>> | null = null;
  try {
    await withFixtureRepo(async (repo) => {
      // the fakes' config is in place before `stint init`, which keeps an existing config, so the commit holds it
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(flowConfig(models.port), null, 2));
      Bun.spawnSync(['git', '-C', repo, 'config', 'user.name', 'Stint Readme']);
      Bun.spawnSync(['git', '-C', repo, 'config', 'user.email', 'readme@example.com']);
      const bin = join(home.dir, '.local', 'bin');
      const env: Record<string, string> = { HOME: home.dir, PATH: `${bin}:${process.env.PATH ?? ''}`, TERM: 'dumb' };
      let cwd = checkout;
      for (const b of blocks) {
        if (b.needs) {
          process.stderr.write(`skipped ${b.file}:${b.line}: needs ${b.needs}\n`);
          continue;
        }
        const lines: string[] = [];
        for (const c of commands(b.text)) {
          if (YOUR_REPO.test(c)) {
            cwd = repo;
            continue;
          }
          if (/^stint up\s*&?$/.test(c)) {
            daemon = await startDaemon({ root: repo, quiet: true, adapters: [writer('muse-code'), writer('stint-agent'), fakeAcp()] });
            continue;
          }
          lines.push(c);
        }
        if (lines.length === 0) continue;
        const p = Bun.spawn(['bash', '-e', '-c', lines.join('\n')], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
        const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
        expect(code, `${b.file}:${b.line} exited ${code}\n${out}\n${err}`).toBe(0);
        if (b.output !== null) {
          const printed = normalise(out);
          for (const want of b.output.split('\n').filter((l) => l.trim())) {
            expect(printed, `${b.file}:${b.line}: the output block says "${want}"`).toContain(normalise(want));
          }
        }
      }
    });
  } finally {
    if (daemon) await (daemon as { stop: () => Promise<void> }).stop();
    models.stop();
    home.cleanup();
  }
}, 300_000);
