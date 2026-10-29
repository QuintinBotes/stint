import { type LearningCurve, learningWords } from '@stint-dev/core';
import { useWidth } from '../hooks';
import { EmptyState } from './ui';

const HEIGHT = 200;
const TOP = 44;
const BOTTOM = 34;
const LEFT = 36;
const RIGHT = 16;
/** A task id under its point needs about this much room, so a crowded axis labels every few points. */
const LABEL_ROOM = 64;

const findings = (n: number) => `${n} finding${n === 1 ? '' : 's'}`;

/** Review findings per task in the order reviewed, a dashed mark where each skill was approved, and the same in words (R-070). */
export function LearningChart({ curve }: { curve: LearningCurve }) {
  const { ref, width: measured } = useWidth<HTMLElement>(640);
  const { points, approvals } = curve;
  if (points.length < 2) return <EmptyState testId="learning-empty">Review findings per task appear once two tasks have been reviewed.</EmptyState>;

  const width = Math.max(300, measured);
  const plotW = width - LEFT - RIGHT;
  const plotH = HEIGHT - TOP - BOTTOM;
  const band = plotW / points.length;
  const max = Math.max(1, ...points.map((p) => p.findings));
  const x = (i: number) => LEFT + band * (i + 0.5);
  const y = (n: number) => TOP + (1 - n / max) * plotH;
  const every = Math.max(1, Math.ceil(LABEL_ROOM / band));
  // the series in reading order, each approval where it fell between the reviews
  const said = points.flatMap((p, i) => [...approvals.filter((a) => a.after === i).map((a) => `${a.skill} approved`), `${p.task}, ${findings(p.findings)}`]);
  said.push(...approvals.filter((a) => a.after === points.length).map((a) => `${a.skill} approved`));

  return (
    <figure ref={ref} className="m-0 flex flex-col gap-3 max-w-[720px]" data-testid="learning-chart">
      {/* max-w-full: a width in pixels would otherwise set the page's narrowest width, so a phone could never measure narrower */}
      <svg width={width} height={HEIGHT} role="img" aria-label={`Review findings per task, in the order reviewed: ${said.join('; ')}.`} className="block max-w-full">
        {[0, max].map((n) => (
          <g key={n}>
            <line x1={LEFT} x2={width - RIGHT} y1={y(n)} y2={y(n)} stroke="var(--rule)" strokeWidth={1} />
            <text x={LEFT - 8} y={y(n) + 4.5} fontSize={13} textAnchor="end" fill="var(--ink-3)" className="tabular">
              {n}
            </text>
          </g>
        ))}
        <path d={points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.findings)}`).join(' ')} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} />
        {points.map((p, i) => (
          <g key={p.task} data-testid="learning-point" data-task={p.task} data-findings={p.findings}>
            <title>{`${p.task}: ${findings(p.findings)} in its last review`}</title>
            <circle cx={x(i)} cy={y(p.findings)} r={4.5} fill="var(--ink)" />
            {band >= 24 ? (
              <text x={x(i)} y={y(p.findings) - 10} fontSize={13} textAnchor="middle" fill="var(--ink-2)" className="tabular">
                {p.findings}
              </text>
            ) : null}
            {i % every === 0 ? (
              <text x={x(i)} y={HEIGHT - 10} fontSize={13} textAnchor="middle" fill="var(--ink-2)" className="font-mono">
                {p.task}
              </text>
            ) : null}
          </g>
        ))}
        {/* shortcut: two skills approved a task or two apart draw their labels over each other; stack them in rows once real data does that */}
        {approvals.map((a) => {
          const ax = LEFT + band * a.after;
          // the label's width, near enough: the id in Geist Mono at 13px, then " approved"; it goes right of the mark when it fits, else left, never off the edge
          const labelW = a.skill.length * 7.8 + 62;
          const start = ax + 6 + labelW <= width;
          return (
            <g key={a.skill} data-testid="learning-approval" data-skill={a.skill}>
              <line x1={ax} x2={ax} y1={24} y2={TOP + plotH} stroke="var(--violet)" strokeWidth={1.5} strokeDasharray="4 3" />
              <text x={start ? ax + 6 : Math.max(ax - 6, labelW)} y={16} fontSize={13} textAnchor={start ? 'start' : 'end'} fill="var(--violet)">
                <tspan className="font-mono">{a.skill}</tspan> approved
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-small text-ink-2 max-w-[65ch]" data-testid="learning-summary">
        {learningWords(curve)}
      </figcaption>
    </figure>
  );
}
