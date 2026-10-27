import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { tempDir } from './helpers';

const root = join(import.meta.dir, '..', '..', '..');

/**
 * Every raw file write in the daemon, the CLI and the adapters, with why it is not one of the store's atomic writers.
 * Anything else that writes under `.stint/` goes through writeFileAtomic or writeJsonAtomic (R-003, R-053).
 */
const ALLOWED: Record<string, string> = {
  'packages/daemon/src/verifier.ts': 'copies scenario files into a scratch checkout it removes',
  'packages/daemon/src/egress.ts': 'the egress sidecar appends to its JSONL log; a torn last line is read again',
  'packages/daemon/src/routes/approve.ts': 'temp files handed to git hash-object and commit-tree, removed after',
  'packages/cli/src/init.ts': 'AGENTS.md and .gitignore in the repository, not under .stint',
  'packages/cli/src/report.ts': 'PROGRESS.md in the repository',
  'packages/cli/src/eval.ts': 'a golden task file in bench/golden',
  'packages/cli/src/bench/results.ts': 'bench results in bench/',
  'packages/cli/src/bench/live.ts': 'recorded bench runs in bench/runs',
  'packages/cli/src/eval/results.ts': 'eval results in bench/',
  'packages/cli/src/eval/live.ts': 'fixtures in a temp clone, and recorded runs in bench/',
  'packages/cli/src/approve.ts': 'stint export writes where the person asks',
  'packages/cli/src/otel.ts': 'stint otel export writes beside the person',
  'packages/adapters/stint-agent/src/tools.ts': "the agent's own edits in its worktree",
  'packages/adapters/acp/src/index.ts': "an ACP agent's writes in its worktree",
  'packages/adapters/muse-code/src/index.ts': 'the enrich prompt and schema in a temp folder',
};

test('every raw file write in the daemon, CLI and adapters is on the list with its reason; .stint writes are atomic', () => {
  const hits = Bun.spawnSync(['git', 'grep', '-l', '-E', '\\b(writeFile|writeFileSync|appendFile|appendFileSync)\\(', '--', 'packages/daemon/src', 'packages/cli/src', 'packages/adapters/*/src'], { cwd: root, stdout: 'pipe' })
    .stdout.toString()
    .split('\n')
    .filter(Boolean);
  const unexplained = hits.filter((f) => !(f in ALLOWED));
  expect(unexplained, 'write through writeFileAtomic or writeJsonAtomic, or add the file here with the reason').toEqual([]);
});

test('writeConfig edits the config as written, sorts its keys, refuses an invalid edit, and the live config follows', async () => {
  const t = tempDir('stint-config-');
  try {
    const ws = await Workspace.open(t.dir);
    const path = join(t.dir, '.stint', 'config.json');
    await ws.writeConfig((raw) => {
      raw.otel = { ...((raw.otel as Record<string, unknown> | undefined) ?? {}), serviceName: 'stint-test' };
    });
    expect(ws.config.otel?.serviceName).toBe('stint-test');
    const text = readFileSync(path, 'utf8');
    const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
    await expect(ws.writeConfig((raw) => { raw.routes = 'not a map'; })).rejects.toThrow('the edited config is invalid');
    expect(readFileSync(path, 'utf8')).toBe(text);
  } finally {
    t.cleanup();
  }
});
