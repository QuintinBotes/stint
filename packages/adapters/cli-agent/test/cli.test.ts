import { expect, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AgentDef, DEFAULT_CONFIG } from '@stint-dev/core';
import { tempDir } from '../../../core/test/fixture';
import { makeApp, newTask, post, withFixtureRepo } from '../../../daemon/test/helpers';
import { agentArgv, cliAgent, cliAgents } from '../src/index';

test('A config entry running a shell script that edits a file and prints two lines yields a run with two agent.message events, a wip commit, a packet and a verification', async () => {
  const tmp = tempDir();
  try {
    const script = join(tmp.dir, 'agent.sh');
    writeFileSync(script, '#!/bin/sh\nread -r first\necho "read the task: $first"\necho "// rate limits come from loadConfig()" >> src/app.ts\necho "done: noted where limits come from"\n');
    chmodSync(script, 0o755);
    await withFixtureRepo(async (repo) => {
      const def: AgentDef = { command: [script], prompt: 'stdin', roles: ['implementer'], vendor: 'other', enabled: true, harness: 'cli' };
      const { app, ws } = await makeApp(repo, [cliAgent('my-agent', def)]);
      const t = await ws.createTask(newTask);
      expect((await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'my-agent', role: 'implementer' })).status).toBe(202);
      for (let i = 0; i < 400 && !(await ws.events(t.id).read()).some((e) => e.type === 'verification.ran'); i++) await Bun.sleep(50);
      for (let i = 0; i < 200 && !(await ws.events(t.id).read()).some((e) => e.type === 'handoff.created'); i++) await Bun.sleep(50);
      const events = await ws.events(t.id).read();
      expect(events.filter((e) => e.type === 'agent.message').map((e) => e.payload.text)).toEqual([expect.stringMatching(/^read the task: /), 'done: noted where limits come from']);
      const finished = events.find((e) => e.type === 'run.finished');
      expect(finished?.payload).toMatchObject({ endedBy: 'completed', cost: { usd: null, estimated: true } });
      expect(typeof finished?.payload.commit).toBe('string');
      expect(events.some((e) => e.type === 'file.changed' && e.payload.path === 'src/app.ts')).toBe(true);
      expect(events.some((e) => e.type === 'verification.ran')).toBe(true);
      expect((await ws.handoffs(t.id).latest())?.from).toMatchObject({ adapter: 'my-agent', vendor: 'other', endedBy: 'completed' });
    });
  } finally {
    tmp.cleanup();
  }
}, 120_000);

test('A disabled preset is not registered; an enabled entry whose command is missing shows unavailable with the reason', async () => {
  expect(cliAgents(DEFAULT_CONFIG).map((a) => a.id)).toEqual([]);
  expect(Object.keys(DEFAULT_CONFIG.agents ?? {}).sort()).toEqual(['aider', 'claude-code', 'codex', 'gemini-cli', 'goose', 'opencode']);
  const missing = cliAgents({ agents: { ghost: { command: ['stint-no-such-agent-cli'], prompt: 'arg', roles: ['implementer'], vendor: 'other', enabled: true, harness: 'cli' } } });
  expect(missing.map((a) => a.id)).toEqual(['ghost']);
  expect(await missing[0]?.available()).toEqual({ ok: false, reason: 'stint-no-such-agent-cli is not on PATH' });
});

test('argv substitution: {prompt} and {model}, and a model flag dropped when no model is set', () => {
  const def: AgentDef = { command: ['agent', '--model', '{model}', '--file', '{prompt}'], prompt: 'file', roles: ['implementer'], vendor: 'local', enabled: true, harness: 'cli' };
  expect(agentArgv(def, { prompt: 'do it', promptPath: '/w/prompt.md', model: 'qwen3-coder' })).toEqual(['agent', '--model', 'qwen3-coder', '--file', '/w/prompt.md']);
  expect(agentArgv({ ...def, command: ['agent', '--model={model}'] }, { prompt: 'do it', promptPath: '/w/prompt.md' })).toEqual(['agent', '/w/prompt.md']);
  expect(agentArgv({ ...def, command: ['agent'], prompt: 'arg' }, { prompt: 'do it', promptPath: '/w/prompt.md' })).toEqual(['agent', 'do it']);
});
