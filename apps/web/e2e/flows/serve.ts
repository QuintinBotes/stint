// The flow tests' server: a real daemon on a fresh copy of the fixture, seeded like the demo, with scripted fake
// agents and a fake model server standing in for the planner, reviewer, learn step, quiz and digest. Nothing here
// calls a hosted model or Ollama.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedDemo } from '../../../../packages/cli/src/demo/seed';
import { replayAdapter, startDaemon } from '@stint-dev/daemon';
import { fakeAcp, flowConfig, sleeper, startFakeModels, writer } from './fakes';

const models = startFakeModels();

const root = mkdtempSync(join(tmpdir(), 'stint-flows-'));
// a fake gh with two open issues, for the intake flow; the daemon runs in this process and finds it on PATH
const bin = join(root, '..', `stint-flows-bin-${process.pid}`);
mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, 'gh'), `#!/bin/sh\nif [ "$1" = "issue" ]; then cat <<'JSON'\n[{"number":7,"title":"Show the tenant name in the audit log","body":"Ops asked.","url":"https://example.invalid/acme/api/issues/7","labels":[]},{"number":8,"title":"Remove the legacy v0 webhook route","body":"Nobody calls it.","url":"https://example.invalid/acme/api/issues/8","labels":[]}]\nJSON\nexit 0; fi\nexit 1\n`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;
const clone = Bun.spawnSync(['git', 'clone', '-q', join(import.meta.dir, '..', '..', '..', '..', 'demo', 'repo.bundle'), root]);
if (clone.exitCode !== 0) throw new Error('cannot clone the fixture');
for (const [k, v] of [['user.name', 'Stint Flows'], ['user.email', 'flows@example.com'], ['commit.gpgsign', 'false']]) Bun.spawnSync(['git', '-C', root, 'config', k as string, v as string]);

const config = flowConfig(models.port);
mkdirSync(join(root, '.stint'), { recursive: true });
writeFileSync(join(root, '.stint', 'config.json'), JSON.stringify(config, null, 2));
await seedDemo(root);

const d = await startDaemon({ root, port: Number(process.env.STINT_E2E_FLOWS_PORT ?? 4320), quiet: true, adapters: [replayAdapter, writer('muse-code'), writer('stint-agent'), sleeper, fakeAcp()] });
process.stdout.write(`ready ${d.url} ${root}\n`);
const stop = () => {
  void d.stop().then(() => {
    models.stop();
    rmSync(root, { recursive: true, force: true });
    process.exit(0);
  });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
