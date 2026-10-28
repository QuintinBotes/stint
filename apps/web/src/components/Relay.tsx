import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { agentOf, carNumber, hostName, markColor, modelName } from '../agents';
import { api } from '../api';
import { money } from '../format';
import { useWidth } from '../hooks';
import { EmptyState } from './ui';

type Lane = { id: string; adapter: string | null; model: string | null; host: string | null; roles: string[]; human: boolean };
type Run = { task: string; run: string; lane: string; role: string | null; start: number; end: number | null; endedBy: string | null; usd: number | null; verified: 'green' | 'red' | null };
type Link =
  | { kind: 'packet'; task: string; from: string; to: string | null; name: string; tokens: number | null; at: number }
  | { kind: 'skill'; skill: string; fromTask: string; from: string; toTask: string; to: string; at: number };
type Mark = { kind: string; task: string; at: number; text: string };
export type RelayData = { lanes: Lane[]; runs: Run[]; links: Link[]; marks: Mark[]; from: number; to: number; replay: boolean };

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
  const { ref: measure, el: box, width: measured } = useWidth<HTMLDivElement>(900);
  const width = Math.max(560, measured);
  const [hover, setHover] = useState<{ x: number; y: number; lines: string[] } | null>(null);
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

  if (!data) return <p className="text-ink-3 text-[12px]">Reading the relay.</p>;
  if (data.runs.length === 0) return <EmptyState>The relay appears here once a run starts: one lane per agent, and a link each time a task passes from one to the next.</EmptyState>;

  // a stint wears its driver's team livery; the car it belongs to is the number on it
  const lanes = new Map(data.lanes.map((l) => [l.id, l]));
  const colour = (lane: string) => {
    const l = lanes.get(lane);
    return !l || l.human ? 'var(--ink)' : markColor[agentOf(l.adapter, l.host, l.model).mark];
  };
  // The axis is the runs' own: a mark written on another clock (a wall-clock approval after a replay's story time) would
  // stretch it until every bar is a sliver, so marks and links well outside the runs are left off.
  const first = Math.min(...data.runs.map((r) => r.start));
  const last = Math.max(...data.runs.map((r) => r.end ?? r.start));
  const slack = Math.max(1, last - first) * 0.25;
  const inside = (t: number) => t >= first - slack && t <= last + slack;
  const marks = data.marks.filter((m) => inside(m.at));
  const links = data.links.filter((l) => inside(l.at));
  const from = Math.min(first, ...marks.map((m) => m.at), ...links.map((l) => l.at));
  const to = Math.max(last, ...marks.map((m) => m.at), ...links.map((l) => l.at));
  const span = Math.max(1, to - from);
  // room on the right for the last bar's label and a killed marker
  const plotW = width - LABEL_W - 72;
  const x = (t: number) => LABEL_W + ((t - from) / span) * plotW;
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
    <div ref={measure} className="relative overflow-x-auto" data-testid="relay" tabIndex={0} aria-label="The relay, scrolls sideways on a narrow screen">
      <svg width={width} height={height} role="img" aria-label="Relay: runs by agent over time, with the packets and skills that connect them" className="block">
        {data.lanes.map((l, i) => {
          const t = laneTitle(l);
          const y = TOP + i * LANE_H;
          return (
            <g key={l.id} data-lane={l.id}>
              <line x1={LABEL_W} y1={y + LANE_H} x2={width - 16} y2={y + LANE_H} stroke="var(--rule)" strokeWidth={1} />
              <rect x={0} y={y + LANE_H / 2 - 14} width={5} height={13} rx={1.5} fill={colour(l.id)} />
              <text x={11} y={y + LANE_H / 2 - 3} fontSize={14} fontWeight={700} fill="var(--ink)">
                {l.human ? 'YOU' : agentOf(l.adapter, l.host, l.model).code}
                {l.human ? null : <tspan fontWeight={400} fill="var(--ink-2)">{` ${t.name}`}</tspan>}
              </text>
              <text x={11} y={y + LANE_H / 2 + 12} fontSize={12} fill="var(--ink-2)">
                {t.detail.length > 28 ? `${t.detail.slice(0, 27)}…` : t.detail}
              </text>
            </g>
          );
        })}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const t = from + (span * i) / ticks;
          return (
            <text key={i} x={x(t)} y={height - 8} fontSize={12} textAnchor="middle" fill="var(--ink-3)" className="tabular">
              {data.replay ? clock(t) : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </text>
          );
        })}

        {links.map((l, i) => {
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
                <path d={curve(x1, y1, x2, y2)} fill="none" stroke="var(--ink-2)" strokeWidth={2} opacity={0.9} />
                <g transform={`translate(${(x1 + x2) / 2},${(y1 + y2) / 2})`}>
                  <rect x={-36} y={-10} width={72} height={20} rx={3} fill="var(--board)" />
                  <text textAnchor="middle" y={4} fontSize={12} fontWeight={700} fill="var(--board-ink)" className="tabular">
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
              <path d={curve(x1, y1, x2, y2)} fill="none" stroke="var(--purple)" strokeWidth={2} strokeDasharray="4 4" />
              <text x={x2 - 8} y={y2 - BAR_H / 2 - 6} textAnchor="end" fontSize={12} fill="var(--purple)">
                learned: {l.skill}
              </text>
            </g>
          );
        })}

        {data.runs.map((r) => {
          const x1 = x(r.start);
          // a short run still gets room for its label
          const x2 = Math.max(x1 + 60, x(r.end ?? to));
          const y = yOf(r.lane) - BAR_H / 2;
          const c = colour(r.lane);
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
              <rect x={x1} y={y} width={x2 - x1} height={BAR_H} rx={3} fill={c} className={r.endedBy ? undefined : 'live-spine'} />
              <text x={x1 + 6} y={y + 15} fontSize={12} fontWeight={800} fill="var(--on-livery)" className="tabular select-none">
                {carNumber(r.task)} {r.run}
              </text>
              {r.endedBy === 'killed' ? (
                <g>
                  <rect x={x2 - 4} y={y} width={4} height={BAR_H} fill="var(--sw-red)" />
                  <text x={x2 + 4} y={y - 2} fontSize={12} fill="var(--red)" fontWeight={700}>
                    killed
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}

        {marks.map((m, i) => {
          const y = yOf('you');
          const mx = x(m.at);
          return (
            <g key={`m${i}`} data-mark={m.kind}>
              <rect x={mx - 6} y={y - 6} width={12} height={12} transform={`rotate(45 ${mx} ${y})`} fill="var(--ink)" />
              <text x={mx + 10} y={y + 4} fontSize={12} fill="var(--ink)">
                {m.kind === 'approved' ? `merged ${m.task}` : m.text.slice(0, 24)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-ink-2" data-testid="relay-legend">
        <span>Each bar is a stint in its driver's team livery; the number on it is the car.</span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block w-4 border-t-2 border-ink-2" /> pit stop, a packet with its tokens
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed border-purple" /> a skill learned on one car, used on another
        </span>
      </div>

      {hover ? (
        <div className="absolute pointer-events-none z-10 rounded-[3px] border border-rule-strong bg-ground px-3 py-2 text-[12px] shadow-[var(--shadow)]" style={{ left: hover.x, top: hover.y }}>
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
