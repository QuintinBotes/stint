import { expect, test } from 'bun:test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDef } from '@stint-dev/core';
import { tempDir } from '../../../core/test/fixture';
import { cliAgent } from '../src/index';

test('R-032 Req 2: a manifest with resume.flag continues a session with that flag and the session id, and only the new instruction as the prompt', async () => {
  const tmp = tempDir();
  try {
    const script = join(tmp.dir, 'agent.sh');
    writeFileSync(script, `#!/bin/sh\nprintf '%s\\n' "$@" > "${tmp.dir}/argv"\necho resumed\n`);
    chmodSync(script, 0o755);
    const def: AgentDef = { command: [script, '--model', '{model}'], prompt: 'arg', roles: ['implementer'], vendor: 'other', model: 'm1', enabled: true, harness: 'cli', resume: { flag: '--resume' } };
    const adapter = cliAgent('resumer', def);
    expect(adapter.capabilities.resumable).toBe(true);
    const ctx = {
      task: { id: 'T-0042' } as never,
      run: 'r2',
      role: 'implementer' as const,
      worktree: tmp.dir,
      prompt: 'the whole first prompt',
      promptPath: join(tmp.dir, 'prompt.md'),
      budget: { tokens: 1000 },
      env: { PATH: process.env.PATH ?? '' },
      signal: new AbortController().signal,
      emit: async () => undefined,
      transcript: async (line: string) => ({ pointer: 'transcript.jsonl:1', byteLen: line.length }),
    };
    const result = await adapter.resume?.({ ...ctx, sessionId: 'sess-9', instruction: 'Read the limit from config.' });
    expect(result).toMatchObject({ endedBy: 'completed', lastMessage: 'resumed' });
    expect(readFileSync(join(tmp.dir, 'argv'), 'utf8').trim().split('\n')).toEqual(['--model', 'm1', 'Read the limit from config.', '--resume', 'sess-9']);
    // without the flag there is no resume: the daemon asks the session nothing and hands on a packet instead
    const plain = cliAgent('plain', { ...def, resume: undefined } as AgentDef);
    expect([plain.capabilities.resumable, plain.resume]).toEqual([false, undefined]);
  } finally {
    tmp.cleanup();
  }
});
