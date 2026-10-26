// A fresh copy of the demo fixture with the recording played instantly, as the UI tests' server builds it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';

export async function withReplay<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'stint-replay-'));
  try {
    const clone = Bun.spawnSync(['git', 'clone', '-q', join(import.meta.dir, '..', '..', '..', 'demo', 'repo.bundle'), root]);
    if (clone.exitCode !== 0) throw new Error('cannot clone the fixture');
    const d = await startDaemon({ root, quiet: true });
    try {
      const play = await fetch(`${d.url}/api/demo/play`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ speed: 0 }) });
      if (play.status !== 202) throw new Error(`replay did not start: ${await play.text()}`);
      // wait for the end, not for "not playing": the status can read idle before playback has begun
      for (let i = 0; i < 1200; i++) {
        const s = (await (await fetch(`${d.url}/api/demo/status`)).json()) as { playing: boolean; done: boolean };
        if (s.done && !s.playing) break;
        await Bun.sleep(50);
      }
    } finally {
      await d.stop();
    }
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
