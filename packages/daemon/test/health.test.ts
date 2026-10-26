import { expect, test } from 'bun:test';
import { KNOWN_ADAPTERS, ptyBackend } from '../src/index';
import { makeApp, tempDir } from './helpers';

test('/api/health with no adapters configured lists each as capability.level unsupported with a reason, never omits one', async () => {
  const tmp = tempDir();
  try {
    const { app } = await makeApp(tmp.dir, []);
    const health = (await (await app.request('/api/health')).json()) as {
      ok: boolean;
      adapters: Array<{ id: string; capability: { level: string; reason?: string }; gate: string }>;
    };
    expect(health.ok).toBe(true);
    expect(health.adapters.map((a) => a.id).sort()).toEqual(KNOWN_ADAPTERS.map((k) => k.id).sort());
    for (const a of health.adapters) {
      expect(a.capability.level).toBe('unsupported');
      expect(a.capability.reason?.length).toBeGreaterThan(0);
    }
  } finally {
    tmp.cleanup();
  }
});

test('`/api/health` reports the PTY backend chosen', async () => {
  const tmp = tempDir();
  try {
    const { app } = await makeApp(tmp.dir, []);
    const health = (await (await app.request('/api/health')).json()) as {
      pty: { backend: string; reason?: string };
    };
    expect(health.pty.backend).toBe(ptyBackend());
    if (health.pty.backend === 'unavailable') {
      expect(health.pty.reason?.length).toBeGreaterThan(0);
    } else {
      expect(health.pty.backend).toBe('bun-terminal');
    }
  } finally {
    tmp.cleanup();
  }
});
