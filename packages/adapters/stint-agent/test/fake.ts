import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';

export type Reply = { status?: number; body?: unknown };

/** An OpenAI-compatible server that answers chat completions from a queue. */
export function fakeHost(replies: Reply[]) {
  const seen: Array<{ messages: unknown[]; tools?: unknown[] }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/models')) return Response.json({ data: [{ id: 'muse-spark-1.3' }] });
      if (url.pathname.endsWith('/chat/completions')) {
        seen.push((await req.json()) as { messages: unknown[] });
        const r = replies.shift() ?? { body: say('Nothing more to do.') };
        return Response.json(r.body ?? { error: { message: 'rate limited' } }, { status: r.status ?? 200 });
      }
      return new Response('not found', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, seen, stop: () => server.stop(true) };
}

const usage = { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 400 } };

export const say = (text: string) => ({ id: 'c', object: 'chat.completion', model: 'muse-spark-1.3', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage });

export const callTool = (name: string, args: Record<string, unknown>, id = `call_${name}`) => ({
  id: 'c',
  object: 'chat.completion',
  model: 'muse-spark-1.3',
  choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
  usage,
});

/** A config whose agent chain points at fake hosts. */
export function configFor(hosts: Record<string, string>): Config {
  const c = structuredClone(DEFAULT_CONFIG);
  for (const [id, url] of Object.entries(hosts)) {
    const h = c.hosts[id];
    if (h) {
      h.baseURL = url;
      delete h.baseURLEnv;
    }
  }
  c.routes.agent = Object.keys(hosts).map((id) => (id === 'meta-api' ? 'meta-api/muse-spark-1.3' : `${id}/muse-spark-open`));
  return c;
}
