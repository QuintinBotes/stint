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

test('/api/health shows reads AGENTS.md and .agents/skills for muse-code with verifiedAgainst', async () => {
  const { museCodeAdapter } = await import('@stint-dev/adapter-muse-code');
  const tmp = tempDir();
  try {
    const { app } = await makeApp(tmp.dir, [museCodeAdapter]);
    const health = (await (await app.request('/api/health')).json()) as { adapters: Array<{ id: string; reads?: Record<string, string>; verifiedAgainst?: string }> };
    const muse = health.adapters.find((a) => a.id === 'muse-code');
    expect(muse?.reads?.['AGENTS.md']).toBe('verified');
    expect(muse?.reads?.['.agents/skills']).toBe('verified');
    expect(muse?.verifiedAgainst).toMatch(/^muse \d+\.\d+\.\d+$/);
  } finally {
    tmp.cleanup();
  }
});

test('a built-in adapter turned off in config is not registered and health lists it as off; availability is checked once, warm at start', async () => {
  const { DEFAULT_CONFIG } = await import('@stint-dev/core');
  const { defaultAdapters, warmAvailability } = await import('../src/index');
  const config = structuredClone(DEFAULT_CONFIG);
  config.adapters['stint-agent'] = { ...(config.adapters['stint-agent'] ?? {}), enabled: false };
  expect(defaultAdapters(config).map((a) => a.id)).not.toContain('stint-agent');

  const tmp = tempDir();
  try {
    let calls = 0;
    const counted = { ...(await import('../src/index')).replayAdapter, id: 'counted', available: async () => {
      calls++;
      return { ok: true, version: 'v1' };
    } };
    const { app, ws } = await makeApp(tmp.dir, [counted]);
    await ws.writeConfig((raw) => {
      raw.adapters = { ...((raw.adapters as Record<string, unknown>) ?? {}), 'stint-agent': { enabled: false } };
    });
    await warmAvailability([counted]);
    const read = async () => (await (await app.request('/api/health')).json()) as { adapters: Array<{ id: string; enabled?: boolean; reason?: string }> };
    const first = await read();
    await read();
    expect(calls).toBe(1);
    expect(first.adapters.find((a) => a.id === 'stint-agent')).toMatchObject({ enabled: false, reason: expect.stringContaining('adapters.stint-agent.enabled') });
  } finally {
    tmp.cleanup();
  }
});
