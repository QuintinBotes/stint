import { expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { type HostCall, hostCall } from '../src/index';

const timeout = (entry: string, config = DEFAULT_CONFIG) => (hostCall(entry, config, { META_API_KEY: 'k' }) as HostCall).client.timeout;

test("A host's own timeoutMs is the least time one Stint agent call to it gets, and 120 s is the time where no host sets one", () => {
  expect(timeout('ollama/muse-glimmer:30b-mlx')).toBe(600_000);
  expect(timeout('meta-api/muse-spark-1.3')).toBe(120_000);
  const config = structuredClone(DEFAULT_CONFIG);
  config.hosts['meta-api'] = { ...(config.hosts['meta-api'] as NonNullable<(typeof config.hosts)[string]>), timeoutMs: 30_000 };
  expect(timeout('meta-api/muse-spark-1.3', config)).toBe(120_000);
});
