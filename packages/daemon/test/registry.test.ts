import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentDefSchema, ConfigSchema, DEFAULT_CONFIG } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { defaultAdapters } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, tempDir, withFixtureRepo } from './helpers';

describe('the open registry', () => {
  test('Assigning an adapter id not in the registry is refused with `adapter_unavailable` naming the configured ids', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo, [fakeAdapter('edit', ['implementer'])]);
      const t = await ws.createTask(newTask);
      const res = await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'nobody', role: 'implementer' });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('adapter_unavailable');
      expect(body.error.message).toContain('nobody');
      expect(body.error.message).toContain('fake');
    });
  });

  test('/api/health lists every configured agent with harness, host, model, roles, capability flags, enabled and availability; disabled agents are listed, not hidden', async () => {
    const tmp = tempDir();
    try {
      const { app } = await makeApp(tmp.dir, []);
      const health = (await (await app.request('/api/health')).json()) as {
        adapters: Array<{
          id: string;
          harness?: string;
          host?: string | null;
          model?: string | null;
          roles: string[];
          capabilities?: Record<string, boolean | undefined>;
          enabled?: boolean;
          available?: boolean;
          capability: { level: string; reason?: string };
          gate: string;
        }>;
      };
      const byId = new Map(health.adapters.map((a) => [a.id, a]));
      for (const id of ['claude-code', 'codex', 'goose', 'opencode', 'gemini-cli', 'aider']) {
        const row = byId.get(id);
        expect(row, id).toBeDefined();
        expect(row?.enabled).toBe(false);
        expect(typeof row?.available).toBe('boolean');
        expect(row?.roles).toContain('implementer');
        expect(row?.capabilities).toBeDefined();
        expect(row?.capability.level).toBe('unsupported');
        expect(row?.capability.reason).toContain('disabled');
        expect(row?.gate).toBe('observed');
        expect(row).toHaveProperty('host');
        expect(row).toHaveProperty('model');
      }
      expect(byId.get('claude-code')?.harness).toBe('claude-code');
      expect(byId.get('codex')?.harness).toBe('codex');
      expect(byId.get('goose')?.harness).toBe('acp');
      expect(byId.get('claude-code')?.capabilities?.costReporting).toBe(true);
    } finally {
      tmp.cleanup();
    }
  });

  test('a host named in a route or a manifest that is not in hosts is a config error at load, in plain words', async () => {
    const badRoute = structuredClone(DEFAULT_CONFIG);
    badRoute.routes.planner = ['nowhere/some-model'];
    const parsed = ConfigSchema.safeParse(badRoute);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((i) => i.message).join(' ')).toContain('route planner names host "nowhere" which is not in hosts');

    const badAgent = structuredClone(DEFAULT_CONFIG);
    (badAgent.agents as Record<string, { host?: string }>).goose = { ...(badAgent.agents?.goose as object), host: 'nowhere' };
    const parsedAgent = ConfigSchema.safeParse(badAgent);
    expect(parsedAgent.success).toBe(false);
    if (!parsedAgent.success) expect(parsedAgent.error.issues.map((i) => i.message).join(' ')).toContain('agent "goose" names host "nowhere" which is not in hosts');

    const tmp = tempDir();
    try {
      mkdirSync(join(tmp.dir, '.stint'), { recursive: true });
      writeFileSync(join(tmp.dir, '.stint', 'config.json'), JSON.stringify(badRoute));
      await expect(Workspace.open(tmp.dir)).rejects.toThrow(/which is not in hosts/);
    } finally {
      tmp.cleanup();
    }
  });

  test('the shipped presets are disabled, name their harness, and carry no flag that bypasses approvals or turns off a sandbox', () => {
    const agents = DEFAULT_CONFIG.agents ?? {};
    expect(Object.keys(agents).sort()).toEqual(['aider', 'claude-code', 'codex', 'gemini-acp', 'gemini-cli', 'goose', 'opencode']);
    const banned = /--yolo|--dangerously|--yes-always|--full-auto|bypassPermissions|danger-full-access/i;
    for (const [id, def] of Object.entries(agents)) {
      expect(def.enabled, id).toBe(false);
      const flags = [...def.command, ...(def.permissions?.flags ?? [])].join(' ');
      expect(flags, id).not.toMatch(banned);
      expect(flags, id).not.toMatch(/--approval-mode[= ]yolo/);
    }
    expect(agents['claude-code']?.harness).toBe('claude-code');
    expect(agents.codex?.harness).toBe('codex');
    expect(agents.goose?.harness).toBe('acp');
    expect(agents['claude-code']?.env).toContain('ANTHROPIC_BASE_URL');
    expect(agents['claude-code']?.env).toContain('ANTHROPIC_AUTH_TOKEN');
  });

  test('defaultAdapters builds the native adapter for claude-code and codex harnesses and the generic adapter for cli', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    for (const id of ['claude-code', 'codex', 'goose'] as const) {
      const def = config.agents?.[id];
      if (def) def.enabled = true;
    }
    const adapters = defaultAdapters(config);
    const byId = new Map(adapters.map((a) => [a.id, a]));
    expect(byId.get('claude-code')?.gate()).toBe('observed');
    expect(byId.get('codex')?.gate()).toBe('observed');
    expect(byId.get('goose')?.gate()).toBe('observed');
    expect(byId.get('claude-code')?.capabilities.resumable).toBe(true);
    expect(byId.get('codex')?.capabilities.resumable).toBe(true);
    expect(byId.get('claude-code')?.needsEnv).toContain('ANTHROPIC_BASE_URL');
    expect(byId.get('codex')?.needsEnv).toContain('OPENAI_API_KEY');
    expect(byId.has('aider')).toBe(false);
  });

  test('tester and learn are roles a manifest can name, and harness defaults to cli', () => {
    const def = AgentDefSchema.parse({ command: ['agent'], prompt: 'stdin', roles: ['tester', 'learn'], vendor: 'local', enabled: true });
    expect(def.roles).toEqual(['tester', 'learn']);
    expect(def.harness).toBe('cli');
  });
});

test('ACP agents are built by the ACP adapter, from harness acp or the acp shorthand', async () => {
  const { DEFAULT_CONFIG } = await import('@stint-dev/core');
  const { defaultAdapters } = await import('../src/server');
  const config = structuredClone(DEFAULT_CONFIG);
  for (const id of ['goose', 'opencode', 'gemini-acp']) (config.agents?.[id] as { enabled: boolean }).enabled = true;
  config.agents = { ...config.agents, mine: { command: ['my-agent', 'acp'], prompt: 'stdin', roles: ['implementer'], vendor: 'other', enabled: true, harness: 'cli', acp: true } };
  const ids = defaultAdapters(config).map((a) => [a.id, a.gate(), a.capabilities.runsCommands]);
  for (const id of ['goose', 'opencode', 'gemini-acp', 'mine']) expect(ids).toContainEqual([id, 'observed', true]);
  expect(config.agents?.goose?.command).toEqual(['goose', 'acp']);
});
