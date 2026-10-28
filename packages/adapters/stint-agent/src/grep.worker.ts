// The grep tool's search, off the daemon's main thread: a model's pattern can backtrack for seconds, and the
// daemon must keep answering while it does. The worker is terminated when it runs over (R-013).
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isCredentialPath } from './refusals';
import { SKIP } from './tools';

declare const self: Worker;

self.onmessage = async (e: MessageEvent<{ root: string; pattern: string; under: string }>) => {
  const { root, pattern, under } = e.data;
  const re = new RegExp(pattern);
  const hits: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (hits.length >= 200 || SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      // a link could lead out of the worktree, and a credential file is never read, whatever the pattern
      if (entry.isSymbolicLink() || isCredentialPath(full.slice(root.length + 1))) continue;
      if (entry.isDirectory()) await walk(full);
      else if ((await stat(full)).size < 512_000) {
        const lines = (await readFile(full, 'utf8')).split('\n');
        lines.forEach((l, i) => {
          if (hits.length < 200 && re.test(l)) hits.push(`${full.slice(root.length + 1)}:${i + 1}: ${l.slice(0, 200)}`);
        });
      }
    }
  };
  try {
    await walk(join(root, under));
    self.postMessage({ hits });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
