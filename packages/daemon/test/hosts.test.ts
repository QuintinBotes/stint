import { expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { modelHealth } from '../src/index';

test('model health: a cloud model is ready when its key is set, waits with the reason when not, and a local model must be pulled', async () => {
  const ollama = Bun.serve({ port: 0, fetch: () => Response.json({ models: [{ name: 'muse-glimmer:30b-mlx' }] }) });
  try {
    const config = structuredClone(DEFAULT_CONFIG);
    config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<(typeof config.hosts)['ollama']>), baseURL: `http://127.0.0.1:${ollama.port}/v1` };
    const rows = await modelHealth(config, { META_API_KEY: 'k' });
    const find = (host: string, model: string) => rows.find((r) => r.host === host && r.model === model);
    expect(find('meta-api', 'muse-spark-1.3')).toMatchObject({ ready: true, roles: expect.arrayContaining(['builds']) });
    expect(find('meta-api', 'muse-wonder-1.0')).toMatchObject({ ready: true, roles: ['plans'] });
    expect(find('baseten', 'muse-spark-open')).toMatchObject({ ready: false, reason: 'BASETEN_API_KEY is not set' });
    expect(find('modal', 'muse-spark-open')).toMatchObject({ ready: false });
    expect(find('ollama', 'muse-glimmer:30b-mlx')).toMatchObject({ ready: true, offline: true, roles: expect.arrayContaining(['reviews']) });
  } finally {
    ollama.stop(true);
  }
});
