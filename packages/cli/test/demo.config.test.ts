import { expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { startDaemon } from '@stint-dev/daemon';
import { freshFixture } from '../src/demo';
import { seedDemoConfig } from '../src/demo/seed';

test('R-069 Requirement 7: the replay\'s config turns on Claude Code on Glimmer through Ollama and Codex on Muse Spark 1.3 through the Meta Model API, so health lists four agents; the defaults are unchanged', async () => {
  const root = freshFixture();
  try {
    await seedDemoConfig(root);
    const once = readFileSync(join(root, '.stint', 'config.json'), 'utf8');
    await seedDemoConfig(root);
    expect(readFileSync(join(root, '.stint', 'config.json'), 'utf8')).toBe(once);
    const d = await startDaemon({ root, quiet: true });
    try {
      const health = (await (await fetch(`${d.url}/api/health`)).json()) as { adapters: Array<{ id: string; enabled?: boolean; model?: string | null; host?: string | null }> };
      const agents = health.adapters.filter((a) => a.id !== 'replay' && a.enabled !== false).map((a) => ({ id: a.id, model: a.model ?? null, host: a.host ?? null }));
      expect(agents).toEqual([
        { id: 'muse-code', model: 'muse-spark-1.3', host: null },
        { id: 'stint-agent', model: 'muse-spark-1.3', host: null },
        { id: 'claude-code', model: 'muse-glimmer:30b-mlx', host: 'ollama' },
        { id: 'codex', model: 'muse-spark-1.3', host: 'meta-api' },
      ]);
      const codex = JSON.parse(once).agents.codex as { env: string[] };
      expect(codex.env).toEqual(['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'META_API_KEY']);
    } finally {
      await d.stop();
    }
    expect([DEFAULT_CONFIG.agents?.['claude-code']?.enabled, DEFAULT_CONFIG.agents?.codex?.enabled]).toEqual([false, false]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
