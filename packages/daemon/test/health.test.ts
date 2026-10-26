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
    // Health also lists every configured agent (R-032); the known adapters are all there.
    for (const k of KNOWN_ADAPTERS) expect(health.adapters.map((a) => a.id)).toContain(k.id);
    for (const a of health.adapters.filter((x) => KNOWN_ADAPTERS.some((k) => k.id === x.id))) {
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

test('/api/health shows reads AGENTS.md for muse-code with verifiedAgainst', async () => {
  const { museCodeAdapter } = await import('@stint-dev/adapter-muse-code');
  const tmp = tempDir();
  try {
    const { app } = await makeApp(tmp.dir, [museCodeAdapter]);
    const health = (await (await app.request('/api/health')).json()) as { adapters: Array<{ id: string; reads?: Record<string, string>; verifiedAgainst?: string }> };
    const muse = health.adapters.find((a) => a.id === 'muse-code');
    expect(muse?.reads?.['AGENTS.md']).toBe('verified');
    expect(muse?.verifiedAgainst).toMatch(/^muse \d+\.\d+\.\d+$/);
  } finally {
    tmp.cleanup();
  }
});
