/// <reference lib="webworker" />
// Lays out the memory graph off the main thread: repulsion between every pair, springs on edges, a pull to
// the centre. 60 nodes is 3,600 pairs a tick, so 240 ticks take a few milliseconds; positions go back in batches.

export type LayoutIn = { type: 'layout'; nodes: Array<{ id: string; pinned?: boolean }>; edges: Array<{ from: string; to: string }>; width: number; height: number };
export type LayoutOut = { type: 'positions'; nodes: Array<{ id: string; x: number; y: number }>; done: boolean };

/** The same start for the same id, so a graph that grows keeps its shape. */
function seed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

self.onmessage = (e: MessageEvent<LayoutIn>) => {
  const { nodes, edges, width, height } = e.data;
  const cx = width / 2;
  const cy = height / 2;
  const pos = nodes.map((n) => {
    const a = seed(n.id) * Math.PI * 2;
    const r = n.pinned ? 0 : 30 + seed(`${n.id}r`) * Math.min(width, height) * 0.3;
    return { id: n.id, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: 0, vy: 0, pinned: !!n.pinned };
  });
  const index = new Map(pos.map((p, i) => [p.id, i]));
  const links = edges.map((l) => [index.get(l.from), index.get(l.to)]).filter((l): l is [number, number] => l[0] !== undefined && l[1] !== undefined);
  const ticks = 240;
  for (let t = 0; t < ticks; t++) {
    const alpha = 1 - t / ticks;
    for (let i = 0; i < pos.length; i++) {
      const a = pos[i] as (typeof pos)[number];
      for (let j = i + 1; j < pos.length; j++) {
        const b = pos[j] as (typeof pos)[number];
        const dx = a.x - b.x || 0.01;
        const dy = a.y - b.y || 0.01;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const f = (90 * alpha) / d2;
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
    }
    for (const [i, j] of links) {
      const a = pos[i] as (typeof pos)[number];
      const b = pos[j] as (typeof pos)[number];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - 56) / d) * 0.08 * alpha;
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    for (const p of pos) {
      if (p.pinned) {
        p.x = cx;
        p.y = cy;
        continue;
      }
      p.vx += (cx - p.x) * 0.02 * alpha;
      p.vy += (cy - p.y) * 0.02 * alpha;
      // a step never jumps further than 8 px, so the layout settles instead of flinging nodes to the walls
      const v = Math.hypot(p.vx, p.vy);
      if (v > 8) {
        p.vx *= 8 / v;
        p.vy *= 8 / v;
      }
      p.x = Math.min(width - 24, Math.max(16, p.x + p.vx));
      p.y = Math.min(height - 12, Math.max(12, p.y + p.vy));
      p.vx *= 0.6;
      p.vy *= 0.6;
    }
    if (t % 40 === 39 || t === ticks - 1) {
      const out: LayoutOut = { type: 'positions', nodes: pos.map(({ id, x, y }) => ({ id, x, y })), done: t === ticks - 1 };
      self.postMessage(out);
    }
  }
};
