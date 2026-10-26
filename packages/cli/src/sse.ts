export type SSEMessage = { event: string; id?: string; data: string };

/** Streams SSE messages from a URL until the signal aborts. */
export async function* readSSE(url: string, signal: AbortSignal, headers: Record<string, string> = {}): AsyncGenerator<SSEMessage> {
  const res = await fetch(url, { headers: { Accept: 'text/event-stream', ...headers }, signal });
  if (!res.ok || !res.body) throw new Error(`stream ${url}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let i = buf.indexOf('\n\n');
      while (i >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const m: SSEMessage = { event: 'message', data: '' };
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) m.event = line.slice(7);
          else if (line.startsWith('id: ')) m.id = line.slice(4);
          else if (line.startsWith('data: ')) m.data += line.slice(6);
        }
        yield m;
        i = buf.indexOf('\n\n');
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    throw err;
  }
}
