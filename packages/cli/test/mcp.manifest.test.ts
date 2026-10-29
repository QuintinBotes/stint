import { expect, test } from 'bun:test';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';
import { fakeAdapter, tempDir, withFixtureRepo } from '../../daemon/test/helpers';

const PLUGIN = join(import.meta.dir, '..', '..', 'adapters', 'muse-code', 'plugin');
const CLI = join(import.meta.dir, '..', 'bin', 'stint');
type Manifest = { capabilities: { hooks: Array<{ command: string[] }>; mcpServers: Array<{ id: string; transport: string; command: string[] }> } };
const manifest = JSON.parse(readFileSync(join(PLUGIN, '.muse-plugin', 'plugin.json'), 'utf8')) as Manifest;

/** Starts a command from the manifest the way Muse Code does, in the plugin folder, and answers JSON-RPC lines. */
function server(command: string[], env: Record<string, string>) {
  const p = Bun.spawn(command, { cwd: PLUGIN, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
  const reader = p.stdout.getReader();
  let buffer = '';
  let id = 0;
  return {
    request: async (method: string, params: Record<string, unknown> = {}) => {
      p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })}\n`);
      p.stdin.flush();
      for (;;) {
        const nl = buffer.indexOf('\n');
        if (nl >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          return JSON.parse(line) as { result: Record<string, unknown> };
        }
        const { value, done } = await reader.read();
        if (done) throw new Error(`the server closed its output: ${await new Response(p.stderr).text()}`);
        buffer += new TextDecoder().decode(value);
      }
    },
    close: () => {
      p.stdin.end();
      p.kill();
    },
  };
}

test('R-028: every command the Muse plugin manifest names is a shell script in the plugin', () => {
  const commands = [...manifest.capabilities.hooks, ...manifest.capabilities.mcpServers].map((c) => c.command);
  expect(commands.map((c) => c[0])).toEqual(['sh', 'sh', 'sh', 'sh']);
  for (const [, script] of commands) {
    expect([script, existsSync(join(PLUGIN, script as string))]).toEqual([script, true]);
    expect([script, Bun.spawnSync(['sh', '-n', join(PLUGIN, script as string)]).exitCode]).toEqual([script, 0]);
  }
});

test('R-028: the MCP server the Muse plugin registers is stint mcp, and inside a run it serves the board of the run\'s repository', async () => {
  const mcp = manifest.capabilities.mcpServers.find((s) => s.id === 'stint');
  expect(mcp?.transport).toBe('stdio');
  const bin = tempDir('stint-bin-');
  writeFileSync(join(bin.dir, 'stint'), `#!/bin/sh\nexec bun "${CLI}" "$@"\n`);
  chmodSync(join(bin.dir, 'stint'), 0o755);
  try {
    await withFixtureRepo(async (repo) => {
      const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...fakeAdapter('edit'), id: 'muse-code' }] });
      const t = await d.ws.createTask({ title: 'Rate-limit the admin API', goal: 'Answer 429 on the admin API.', acceptance: ['429'] });
      const s = server(mcp?.command as string[], { PATH: `${bin.dir}:${process.env.PATH}`, STINT_WORKTREE: join(repo, '.stint', 'worktrees', `${t.id}-r1`), STINT_TASK: t.id });
      try {
        expect((await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'muse', version: '1' } })).result.serverInfo).toMatchObject({ name: 'stint' });
        const names = ((await s.request('tools/list')).result.tools as Array<{ name: string }>).map((x) => x.name);
        expect(names).toContain('stint_status');
        const status = (await s.request('tools/call', { name: 'stint_status', arguments: {} })).result as { content: Array<{ text: string }> };
        expect(status.content[0]?.text).toContain(`${t.id} [planned] Rate-limit the admin API`);
      } finally {
        s.close();
        await d.stop();
      }
    });
  } finally {
    bin.cleanup();
  }
}, 60_000);

test('R-028: with no stint on PATH the registered server says so on stderr and exits 1, so Muse shows the tools as missing', () => {
  const mcp = manifest.capabilities.mcpServers.find((s) => s.id === 'stint');
  const r = Bun.spawnSync(mcp?.command as string[], { cwd: PLUGIN, env: { PATH: '/usr/bin:/bin' }, stderr: 'pipe' });
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toBe("Stint MCP: the stint command is not on PATH, so Stint's tools are not available.\n");
});
