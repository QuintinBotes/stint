// The UI tests' server: a daemon on a fresh copy of the demo fixture with the recording played instantly.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';

const root = mkdtempSync(join(tmpdir(), 'stint-e2e-'));
const clone = Bun.spawnSync(['git', 'clone', '-q', join(import.meta.dir, '..', '..', '..', 'demo', 'repo.bundle'), root]);
if (clone.exitCode !== 0) throw new Error('cannot clone the fixture');
const d = await startDaemon({ root, port: Number(process.env.STINT_E2E_PORT ?? 4319), quiet: true });
const play = await fetch(`${d.url}/api/demo/play`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ speed: 0 }) });
if (play.status !== 202) throw new Error(`replay did not start: ${await play.text()}`);
while (((await (await fetch(`${d.url}/api/demo/status`)).json()) as { playing: boolean }).playing) await Bun.sleep(50);
process.stdout.write(`ready ${d.url}\n`);
const stop = () => {
  void d.stop().then(() => {
    rmSync(root, { recursive: true, force: true });
    process.exit(0);
  });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
