import type { Handoff } from '@stint-dev/core';
import { agentOf, carNumber } from '../agents';
import { cx } from './ui';

/** A board line: short ones in the board's capitals; `ask` is the packet's ask of next, in sentence case. */
type Line = { text: string; tone?: 'warn' | 'dim' | 'ask' };

const VERB: Record<string, string> = { implementer: 'build', reviewer: 'review', planner: 'plan' };

/** The pit board's lines, from the packet the last stop left: who goes out next, to do what, and how big the packet is. */
export function boardLines(taskId: string, packet: Handoff | null, meta: { name: string | null; tokens: number | null; bytes: number | null }): Line[] {
  const lines: Line[] = [{ text: `Car ${carNumber(taskId)}` }];
  const size = meta.tokens !== null ? `${meta.tokens} tok${meta.bytes ? `  ${(meta.bytes / 1024).toFixed(1)} KB` : ''}` : null;
  if (!packet) return lines;
  const to = packet.to;
  const who = !to ? 'Next' : to.adapter === 'openai-compatible' ? 'Next' : agentOf(to.adapter).code;
  lines.push({ text: `${who}: ${VERB[to?.role ?? 'implementer'] ?? 'continue'}` });
  if (packet.leftOut.some((l) => /^In-flight step unknown/.test(l))) lines.push({ text: 'In-flight step unknown', tone: 'warn' });
  lines.push({ text: packet.askOfNext, tone: 'ask' });
  if (size) lines.push({ text: size, tone: 'dim' });
  return lines;
}

/** The pit board: the packet's ask of next, in the board's own type. It opens the packet. */
export function PitBoard({ lines, label, onOpen, testId = 'pit-board' }: { lines: Line[]; label: string; onOpen?: () => void; testId?: string }) {
  // named by what it says, so the name a screen reader hears is the text on the board
  const body = (
    <>
      <span className="sr-only">{label}: </span>
      {lines.map((l, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the board's lines have no identity but their place
          key={i}
          className={cx(
            l.tone === 'ask' ? 'my-1 text-[14px] leading-5 font-semibold normal-case tracking-normal [font-stretch:100%]' : 'uppercase',
            l.tone === 'warn' && 'text-[var(--sw-yellow)]',
            l.tone === 'dim' && 'text-[12px] leading-4 tabular opacity-75',
          )}
        >
          {l.text}
          <span className="sr-only">. </span>
        </span>
      ))}
      {onOpen ? <span className="sr-only">Open the packet.</span> : null}
    </>
  );
  const cls = 'flex flex-col w-full text-left rounded-[4px] bg-board text-board-ink px-4 py-3 text-[19px] leading-6 font-extrabold stretch-70 tracking-[0.02em]';
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cx(cls, 'hover:outline hover:outline-1 hover:outline-ink-3')} data-testid={testId}>
      {body}
    </button>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}
