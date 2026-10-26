import { asOf, constrains, filesTogether, openFindings, project, similar, skillsHelped, type Graph } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';

const MAX_NODES = 60;
const QUERIES = ['similar', 'files-together', 'constrains', 'open-findings', 'skills-helped'];

function checkedTime(raw: string | undefined, name: string): string | null {
  if (!raw) return null;
  if (Number.isNaN(Date.parse(raw))) throw new DaemonError('invalid', `${name} is not a time: ${raw}`, 'send an ISO 8601 time, e.g. 2026-10-29T14:40:00Z');
  return raw;
}

/** Nodes around one task: the task first, then nearest first (fewest hops, then most edges). */
function around(graph: Graph, centre: string): { nodes: Graph['nodes']; edges: Graph['edges']; total: number } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const neighbours = new Map<string, Set<string>>();
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]] as const) {
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      neighbours.get(a)?.add(b);
    }
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const distance = new Map<string, number>([[centre, 0]]);
  const queue = [centre];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of neighbours.get(cur) ?? []) {
      if (distance.has(next)) continue;
      distance.set(next, (distance.get(cur) ?? 0) + 1);
      queue.push(next);
    }
  }
  const ranked = [...distance.entries()]
    .filter(([id]) => byId.has(id))
    .sort(([aId, aDist], [bId, bDist]) => aDist - bDist || (degree.get(bId) ?? 0) - (degree.get(aId) ?? 0) || aId.localeCompare(bId));
  const kept = ranked.slice(0, MAX_NODES).map(([id]) => byId.get(id) as Graph['nodes'][number]);
  const keptIds = new Set(kept.map((n) => n.id));
  return { nodes: kept, edges: graph.edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to)), total: ranked.length };
}

export function graphRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/tasks/:id/graph', async (c) => {
    const id = c.req.param('id');
    await ctx.ws.readTask(id);
    const at = checkedTime(c.req.query('asOf'), 'asOf');
    const full = await project(ctx.ws);
    const graph = at ? asOf(full, at) : full;
    const { nodes, edges, total } = around(graph, `task:${id}`);
    // A moment before the task's first edge still has the task itself to show.
    if (nodes.length === 0 || nodes[0]?.id !== `task:${id}`) {
      const taskNode = full.nodes.find((n) => n.id === `task:${id}`);
      if (taskNode) nodes.unshift(taskNode);
    }
    return c.json({ nodes: nodes.slice(0, MAX_NODES), edges, asOf: at, total });
  });

  app.get('/api/graph/query', async (c) => {
    const q = c.req.query('q') ?? '';
    if (!QUERIES.includes(q)) throw new DaemonError('invalid', `unknown query ${q || '(none)'}`, QUERIES.join(', '));
    const task = c.req.query('task');
    const needTask = async () => {
      if (!task) throw new DaemonError('invalid', `q=${q} needs a task`, 'add &task=T-0042');
      await ctx.ws.readTask(task);
      return task;
    };
    switch (q) {
      case 'similar':
        return c.json(await similar(ctx.ws, await needTask()));
      case 'constrains':
        return c.json(await constrains(ctx.ws, await needTask(), checkedTime(c.req.query('asOf'), 'asOf') ?? undefined));
      case 'open-findings':
        return c.json(await openFindings(ctx.ws, await needTask()));
      case 'files-together': {
        const path = c.req.query('path');
        if (!path) throw new DaemonError('invalid', 'q=files-together needs a path', 'add &path=src/lib/limiter.ts');
        return c.json(await filesTogether(ctx.ws, path));
      }
      default:
        return c.json(await skillsHelped(ctx.ws));
    }
  });
}
