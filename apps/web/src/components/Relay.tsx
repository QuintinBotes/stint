import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { hostName, modelName } from '../agents';
import { api } from '../api';
import { money } from '../format';
import { EmptyState } from './ui';

type Lane = { id: string; adapter: string | null; model: string | null; host: string | null; roles: string[]; human: boolean };
type Run = { task: string; run: string; lane: string; role: string | null; start: number; end: number | null; endedBy: string | null; usd: number | null; verified: 'green' | 'red' | null };
type Link =
  | { kind: 'packet'; task: string; from: string; to: string | null; name: string; tokens: number | null; at: number }
  | { kind: 'skill'; skill: string; fromTask: string; from: string; toTask: string; to: string; at: number };
type Mark = { kind: string; task: string; at: number; text: string };
export type RelayData = { lanes: Lane[]; runs: Run[]; links: Link[]; marks: Mark[]; from: number; to: number; replay: boolean };

// categorical slots in fixed order, validated against the dark surface; a task keeps its colour by its place on the board
const TASK_COLOURS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];

const LABEL_W = 176;
const LANE_H = 52;
const BAR_H = 22;
const TOP = 28;

const AGENT: Record<string, string> = { 'muse-code': 'Muse Code', 'stint-agent': 'Stint agent', replay: 'Replay' };

function laneTitle(l: Lane): { name: string; detail: string } {
  if (l.human) return { name: 'You', detail: 'approve, decide, merge' };
  const model = l.model ? modelName(l.model) : 'its model';
  if (l.adapter && l.adapter !== 'openai-compatible') return { name: AGENT[l.adapter] ?? l.adapter, detail: `${model}${l.host ? `, ${hostName(l.host)}` : ''}` };
  const did = l.roles.map((r) => ({ planner: 'plans', reviewer: 'reviews', implementer: 'builds' })[r] ?? r).join(', ');
  return { name: model, detail: `${did} on ${l.host === 'ollama' ? 'this machine' : hostName(l.host)}` };
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

/** The whole floor: every run on its agent's lane, the packets that carried a task on, and the lesson that crossed tasks. */
export function Relay() {
  const [data, setData] = useState<RelayData | null>(null);
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .relay()
        .then((d) => live && setData(d))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (!box.current) return;
    const obs = new ResizeObserver(([e]) => e && setWidth(Math.max(560, e.contentRect.width)));
    obs.observe(box.current);
    return () => obs.disconnect();
  }, []);

  if (!data) return <p className="text-faint text-[13px]">Reading the floor.</p>;
  if (data.runs.length === 0) return <EmptyState>The relay appears here once a run starts: one lane per agent, and a link each time a task passes from one to the next.</EmptyState>;

  const palette = TASK_COLOURS;
  const tasks = [...new Set(data.runs.map((r) => r.task))].sort();
  const colour = (task: string) => palette[tasks.indexOf(task) % palette.length] as string;
  const span = Math.max(1, data.to - data.from);
  // room on the right for the last bar's label and a killed marker
  const plotW = width - LABEL_W - 72;
  const x = (t: number) => LABEL_W + ((t - data.from) / span) * plotW;
  const laneIndex = new Map(data.lanes.map((l, i) => [l.id, i]));
  const yOf = (lane: string) => TOP + (laneIndex.get(lane) ?? 0) * LANE_H + LANE_H / 2;
  const runOf = (task: string, run: string) => data.runs.find((r) => r.task === task && r.run === run);
  const height = TOP + data.lanes.length * LANE_H + 28;
  const ticks = 6;

  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  };

  return (
    <div ref={box} className="relative" data-testid="relay">
      <svg width={width} height={height} role="img" aria-label="Relay: runs by agent over time, with the packets and skills that connect them" className="block">
        {data.lanes.map((l, i) => {
          const t = laneTitle(l);
          const y = TOP + i * LANE_H;
          return (
            <g key={l.id} data-lane={l.id}>
              <line x1={LABEL_W} y1={y + LANE_H} x2={width - 16} y2={y + LANE_H} stroke="var(--border)" strokeWidth={1} />
              <text x={0} y={y + LANE_H / 2 - 3} fontSize={12.5} fontWeight={600} fill="var(--ink)">
                {t.name}
              </text>
              <text x={0} y={y + LANE_H / 2 + 12} fontSize={11} fill="var(--ink-muted)">
                {t.detail.length > 28 ? `${t.detail.slice(0, 27)}…` : t.detail}
              </text>
            </g>
          );
        })}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const t = data.from + (span * i) / ticks;
          return (
            <text key={i} x={x(t)} y={height - 8} fontSize={10.5} textAnchor="middle" fill="var(--ink-faint)" className="tabular">
              {data.replay ? clock(t) : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </text>
          );
        })}

        {data.links.map((l, i) => {
          if (l.kind === 'packet') {
            const a = runOf(l.task, l.from);
            const b = l.to ? runOf(l.task, l.to) : null;
            if (!a) return null;
            const x1 = x(a.end ?? a.start);
            const y1 = yOf(a.lane);
            if (!b) return null;
            const x2 = x(b.start);
            const y2 = yOf(b.lane);
            return (
              <g key={`p${i}`} data-link="packet">
                <path d={curve(x1, y1, x2, y2)} fill="none" stroke={colour(l.task)} strokeWidth={2} opacity={0.9} />
                <g transform={`translate(${(x1 + x2) / 2},${(y1 + y2) / 2})`}>
                  <rect x={-34} y={-10} width={68} height={20} rx={10} fill="var(--surface-raised)" stroke={colour(l.task)} strokeWidth={1.5} />
                  <text textAnchor="middle" y={4} fontSize={10.5} fill="var(--ink)" className="tabular">
                    {l.tokens ? `${l.tokens} tok` : l.name}
                  </text>
                </g>
              </g>
            );
          }
          const a = runOf(l.fromTask, l.from);
          const b = runOf(l.toTask, l.to);
          if (!a || !b) return null;
          const x1 = x(a.end ?? a.start);
          const y1 = yOf(a.lane);
          const x2 = x(b.start);
          const y2 = yOf(b.lane);
          return (
            <g key={`s${i}`} data-link="skill">
              <path d={curve(x1, y1, x2, y2)} fill="none" stroke="var(--ink-muted)" strokeWidth={1.5} strokeDasharray="4 4" />
              <text x={x2 - 8} y={y2 - BAR_H / 2 - 6} textAnchor="end" fontSize={10.5} fill="var(--ink-muted)">
                learned: {l.skill}
              </text>
            </g>
          );
        })}

        {data.runs.map((r) => {
          const x1 = x(r.start);
          // a short run still gets room for its label
          const x2 = Math.max(x1 + 60, x(r.end ?? data.to));
          const y = yOf(r.lane) - BAR_H / 2;
          const c = colour(r.task);
          const lines = [
            `${r.task} ${r.run}, ${r.role ?? 'run'}`,
            `${r.endedBy ? `ended ${r.endedBy}` : 'running'}${r.end ? `, ${clock(r.end - r.start)}` : ''}`,
            `${r.usd === null ? 'unpriced' : money({ usd: r.usd })}${r.verified ? `, tests ${r.verified}` : ''}`,
          ];
          return (
            <g
              key={`${r.task}/${r.run}`}
              data-run={`${r.task}/${r.run}`}
              className="cursor-pointer"
              onClick={() => navigate(`/t/${r.task}`)}
              onMouseMove={(e) => {
                const rect = box.current?.getBoundingClientRect();
                if (rect) setHover({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12, lines });
              }}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={x1} y={y} width={x2 - x1} height={BAR_H} rx={4} fill={c} opacity={r.endedBy ? 0.92 : 0.6} />
              <text x={x1 + 6} y={y + 15} fontSize={11} fontWeight={600} fill="#0b0b0d" className="tabular select-none">
                {r.task.replace('T-', '')} {r.run}
              </text>
              {r.endedBy === 'killed' ? (
                <g>
                  <rect x={x2 - 3} y={y - 4} width={3} height={BAR_H + 8} fill="var(--status-bad)" />
                  <text x={x2 + 4} y={y - 2} fontSize={10.5} fill="var(--status-bad)" fontWeight={600}>
                    killed
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}

        {data.marks.map((m, i) => {
          const y = yOf('you');
          const mx = x(m.at);
          return (
            <g key={`m${i}`} data-mark={m.kind}>
              <rect x={mx - 6} y={y - 6} width={12} height={12} transform={`rotate(45 ${mx} ${y})`} fill={colour(m.task)} />
              <text x={mx + 10} y={y + 4} fontSize={10.5} fill="var(--ink)">
                {m.kind === 'approved' ? `merged ${m.task}` : m.text.slice(0, 24)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-muted" data-testid="relay-legend">
        {tasks.map((t) => (
          <span key={t} className="inline-flex items-center gap-1">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: colour(t) }} />
            {t}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block w-4 border-t-2" style={{ borderColor: 'var(--ink-muted)' }} /> packet, with its tokens
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block w-4 border-t border-dashed" style={{ borderColor: 'var(--ink-muted)' }} /> a skill learned on one task, used on another
        </span>
      </div>

      {hover ? (
        <div className="absolute pointer-events-none z-10 rounded-md border border-line bg-raised px-2.5 py-1.5 text-[12px] shadow-[var(--shadow-overlay)]" style={{ left: hover.x, top: hover.y }}>
          {hover.lines.map((l) => (
            <div key={l} className="tabular whitespace-nowrap">
              {l}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
