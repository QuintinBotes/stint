import { type Host, hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import type { HostConfig, StintEvent } from '@stint-dev/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { walkChain } from '../route';

const Summary = z.strictObject({ summary: z.string().min(1).max(600) });
type SummaryValue = z.infer<typeof Summary>;

export type TaskSummary = {
  summary: string;
  seq: number;
  source: 'model' | 'agent.message' | 'none';
  host?: string;
  model?: string;
};

type CachedSummary = { summary: string; seq: number; source: 'model'; host: string; model: string };

/**
 * A host that runs on this machine: it says it works offline, or it needs no key and
 * answers on a local address. Board cards never spend hosted credits.
 */
function isLocalHost(config: HostConfig, env: Record<string, string | undefined> = process.env): boolean {
  if (config.offline) return true;
  if (config.keyEnv) return false;
  const url = config.baseURL ?? (config.baseURLEnv ? env[config.baseURLEnv] : undefined);
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** The recent events as plain lines a small model can summarise; payload detail stays short. */
function eventLines(events: StintEvent[]): string {
  return events
    .slice(-40)
    .map((e) => {
      const p = e.payload;
      const detail = [p.text, p.status, p.endedBy, p.verdict, p.reason].find((v) => typeof v === 'string' && v) ?? '';
      return `${e.seq} ${e.type}${e.run ? ` ${e.run}` : ''}${detail ? `: ${String(detail).slice(0, 160)}` : ''}`;
    })
    .join('\n');
}

function lastAgentMessage(events: StintEvent[]): string | null {
  for (const e of [...events].reverse()) {
    if (e.type === 'agent.message' && typeof e.payload.text === 'string' && e.payload.text) return e.payload.text.slice(0, 300);
  }
  return null;
}

export function summaryRoutes(app: Hono, ctx: DaemonContext): void {
  // the board card line: a local model summarises recent events, cached per event seq
  app.post('/api/tasks/:id/summary', async (c) => {
    const id = c.req.param('id');
    const task = await ctx.ws.readTask(id);
    const events = await ctx.ws.events(id).read();
    const seq = events.at(-1)?.seq ?? 0;

    const cached = await ctx.ws.readDoc<CachedSummary>(id, 'summary.json').catch(() => null);
    if (cached && cached.seq === seq && cached.summary) {
      return c.json({ summary: cached.summary, seq, source: 'model', host: cached.host, model: cached.model } satisfies TaskSummary);
    }

    const fallback = (): TaskSummary => {
      const text = lastAgentMessage(events);
      return text ? { summary: text, seq, source: 'agent.message' } : { summary: '', seq, source: 'none' };
    };

    const chain = (ctx.ws.config.routes.summary ?? []).filter((entry) => {
      const hostId = entry.split('/')[0] as string;
      const host = ctx.ws.config.hosts[hostId];
      return !!host && isLocalHost(host);
    });
    if (chain.length === 0) return c.json(fallback());

    const prompt = `Summarise what has happened on this task in one or two plain sentences for a board card. Say where the work has got to and what happens next, from the events alone. No preamble, nothing the events do not show.

Task: ${task.title}. ${task.goal}
Status: ${task.status}

Recent events:
${eventLines(events)}`;

    try {
      const result = await walkChain<{ value: SummaryValue }>({
        role: 'summary',
        chain,
        hosts: hostsFromConfig(ctx.ws.config) as Record<string, Host>,
        call: (h, model, callCtx) => h.complete(Summary, prompt, { model, timeoutMs: callCtx.timeoutMs, emit: callCtx.emit }),
      });
      const value = ((result.value as { value?: SummaryValue }).value ?? result.value) as SummaryValue;
      const summary = value.summary.trim().slice(0, 400);
      if (!summary) return c.json(fallback());
      await ctx.ws.writeDoc(id, 'summary.json', { summary, seq, source: 'model', host: result.host, model: result.model } satisfies CachedSummary);
      return c.json({ summary, seq, source: 'model', host: result.host, model: result.model } satisfies TaskSummary);
    } catch {
      // no local model could answer: the last thing the agent said, with no further call
      return c.json(fallback());
    }
  });
}
