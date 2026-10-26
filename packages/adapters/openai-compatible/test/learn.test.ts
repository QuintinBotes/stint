import { expect, test } from 'bun:test';
import { SkillProposalSchema } from '@stint-dev/core';
import { makeHost } from '../src/index';

const modelProposal = {
  version: 'stint.skillProposal/1',
  id: 'limiter-config-via-env',
  name: 'Limits come from config',
  description: 'Use when adding a limit: read it through loadConfig with a default.',
  roles: ['implementer', 'reviewer'],
  tags: ['limits', 'config'],
  rule: 'Every limit is read through loadConfig from an env var with a default.',
  examples: [{ task: 'T-0042', run: 'r3' }],
  evidence: ['T-0042/r4#F1', 'T-0040/r3#F2'],
  confidence: 0.82,
};

test('learn() returns a validated skill proposal from one structured call', async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/v1/models') return Response.json({ object: 'list', data: [] });
      return Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'muse-spark-open',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(modelProposal) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
      });
    },
  });
  try {
    const host = makeHost(
      'baseten',
      {
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        keyEnv: 'BASETEN_API_KEY',
        models: { 'muse-spark-open': 'muse-spark-open' },
        offline: false,
        structuredOutput: 'accepted',
        cachedInput: true,
      },
      { BASETEN_API_KEY: 'test-key' },
    );
    const proposal = await host.learn({ prompt: 'Propose a skill from these findings.', model: 'muse-spark-open' });
    expect(SkillProposalSchema.parse(proposal)).toEqual(proposal);
    expect(proposal.model).toBe('baseten/muse-spark-open');
  } finally {
    server.stop(true);
  }
});
