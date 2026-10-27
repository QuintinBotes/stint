import { expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '../src/index';
test('The default chains try local models first for review and summary, and last for building', () => {
  const local = (e: string) => e.startsWith('ollama/');
  expect(local(DEFAULT_CONFIG.routes.reviewer[0] as string)).toBe(true);
  expect(local(DEFAULT_CONFIG.routes.summary[0] as string)).toBe(true);
  const agent = DEFAULT_CONFIG.routes.agent ?? [];
  expect(agent.findIndex(local)).toBe(agent.length - 1);
  expect(agent[0]).toBe('meta-api/muse-spark-1.3');
});

test('config.metrics defaults the outcome window to 7 days, ships no targets, and refuses an unknown target id with the known ids', async () => {
  const { ConfigSchema } = await import('../src/index');
  expect(DEFAULT_CONFIG.metrics).toEqual({ outcomeWindowDays: 7 });
  const bad = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
  bad.metrics = { outcomeWindowDays: 7, targets: { 'verify.not_a_metric': { max: 0 } } };
  const parsed = ConfigSchema.safeParse(bad);
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.message).toContain('verify.tamper_escapes');
  const good = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
  good.metrics = { outcomeWindowDays: 14, targets: { 'verify.tamper_escapes': { max: 0 } } };
  expect(ConfigSchema.safeParse(good).success).toBe(true);
});

test('The default config validates with LM Studio, llama.cpp and a LiteLLM gateway as hosts, and no route names them', async () => {
  const { ConfigSchema } = await import('../src/index');
  expect(ConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
  for (const host of ['lmstudio', 'llamacpp', 'litellm']) {
    expect(DEFAULT_CONFIG.hosts[host]).toBeDefined();
    for (const chain of Object.values(DEFAULT_CONFIG.routes)) expect((chain ?? []).some((e) => e.startsWith(`${host}/`))).toBe(false);
  }
});
