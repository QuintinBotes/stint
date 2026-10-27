import { expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { chainHealth, localModels, modelHealth } from '../src/index';

test('model health: a cloud model is ready when its key is set, waits with the reason when not, and a local model must be pulled', async () => {
  const ollama = Bun.serve({ port: 0, fetch: () => Response.json({ models: [{ name: 'muse-glimmer:30b-mlx' }] }) });
  try {
    const config = structuredClone(DEFAULT_CONFIG);
    config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<(typeof config.hosts)['ollama']>), baseURL: `http://127.0.0.1:${ollama.port}/v1` };
    const rows = await modelHealth(config, { META_API_KEY: 'k' });
    const find = (host: string, model: string) => rows.find((r) => r.host === host && r.model === model);
    expect(find('meta-api', 'muse-spark-1.3')).toMatchObject({ ready: true, roles: expect.arrayContaining(['builds']) });
    expect(find('meta-api', 'muse-wonder-1.0')).toMatchObject({ ready: true, roles: ['checks packets', 'plans'] });
    expect(find('baseten', 'muse-spark-open')).toMatchObject({ ready: false, reason: 'BASETEN_API_KEY is not set' });
    expect(find('modal', 'muse-spark-open')).toMatchObject({ ready: false });
    expect(find('ollama', 'muse-glimmer:30b-mlx')).toMatchObject({ ready: true, offline: true, roles: expect.arrayContaining(['reviews']) });
  } finally {
    ollama.stop(true);
  }
});

test("health's chains walk each role in config order with each entry's readiness; a local host has a measured latency, a cloud host none", async () => {
  const ollama = Bun.serve({ port: 0, fetch: () => Response.json({ models: [{ name: 'muse-glimmer:30b-mlx' }] }) });
  try {
    const config = structuredClone(DEFAULT_CONFIG);
    config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<(typeof config.hosts)['ollama']>), baseURL: `http://127.0.0.1:${ollama.port}/v1#chains` };
    const rows = await modelHealth(config, { META_API_KEY: 'k' });
    const chains = chainHealth(config, rows);
    expect(chains.reviewer?.map((c) => c.entry)).toEqual(config.routes.reviewer as string[]);
    expect(chains.reviewer?.find((c) => c.entry === 'ollama/muse-glimmer:30b-mlx')).toEqual({ entry: 'ollama/muse-glimmer:30b-mlx', ready: true, reason: null });
    expect(chains.reviewer?.find((c) => c.entry.startsWith('baseten/'))).toMatchObject({ ready: false, reason: 'BASETEN_API_KEY is not set' });
    const local = rows.find((r) => r.host === 'ollama');
    expect(local?.latencyMs).toBeNumber();
    expect(local?.structuredOutput).toBe(config.hosts.ollama?.structuredOutput ?? null);
    expect(rows.find((r) => r.host === 'meta-api')?.latencyMs).toBeNull();
  } finally {
    ollama.stop(true);
  }
});

test('local models lists chat models pulled on a keyless host that no route names, and leaves out embeddings and routed ones', async () => {
  const ollama = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        models: [
          { name: 'muse-glimmer:30b-mlx', details: { family: '' } },
          { name: 'qwen3:8b', details: { family: 'qwen3', families: ['qwen3'], parameter_size: '8.2B' } },
          { name: 'bge-m3:latest', details: { family: 'bert', families: ['bert'] } },
        ],
      }),
  });
  try {
    const config = structuredClone(DEFAULT_CONFIG);
    config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<(typeof config.hosts)['ollama']>), baseURL: `http://127.0.0.1:${ollama.port}/v1#local` };
    expect(await localModels(config, {})).toEqual([{ host: 'ollama', model: 'qwen3:8b', parameters: '8.2B' }]);
  } finally {
    ollama.stop(true);
  }
});

test('a local server without /api/tags, such as LM Studio or llama.cpp, lists its chat models through /v1/models', async () => {
  const lmstudio = Bun.serve({
    port: 0,
    fetch: (req) => (new URL(req.url).pathname === '/v1/models' ? Response.json({ data: [{ id: 'qwen2.5-coder-7b' }, { id: 'text-embedding-nomic-embed-text-v1.5' }] }) : new Response('not found', { status: 404 })),
  });
  try {
    const config = structuredClone(DEFAULT_CONFIG);
    config.hosts = { lmstudio: { ...(config.hosts.lmstudio as NonNullable<(typeof config.hosts)['lmstudio']>), baseURL: `http://127.0.0.1:${lmstudio.port}/v1` } };
    expect(await localModels(config, {})).toEqual([{ host: 'lmstudio', model: 'qwen2.5-coder-7b', parameters: null }]);
  } finally {
    lmstudio.stop(true);
  }
});
