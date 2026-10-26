import { countTokens } from '@stint-dev/core';

export type CappedDiff = { text: string; includedHunks: number; leftOutHunks: number };

type Hunk = { header: string; body: string };

function splitHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let header = '';
  let current: string[] | null = null;
  const flush = () => {
    if (current) hunks.push({ header, body: current.join('\n') });
    current = null;
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      header = line;
    } else if (line.startsWith('@@')) {
      flush();
      current = [line];
    } else if (current) {
      current.push(line);
    } else if (header) {
      header = `${header}\n${line}`;
    } else {
      header = line;
    }
  }
  flush();
  if (hunks.length === 0 && diff.trim()) hunks.push({ header: '', body: diff });
  return hunks;
}

/** Cap a unified diff at maxTokens, largest hunks first, and say how many hunks were left out. */
export function capDiff(diff: string, maxTokens = 3000): CappedDiff {
  if (!diff.trim()) return { text: '', includedHunks: 0, leftOutHunks: 0 };
  if (countTokens(diff) <= maxTokens) {
    const hunks = splitHunks(diff);
    return { text: diff, includedHunks: hunks.length, leftOutHunks: 0 };
  }
  const ranked = splitHunks(diff)
    .map((hunk) => ({ ...hunk, rendered: hunk.header ? `${hunk.header}\n${hunk.body}` : hunk.body }))
    .sort((a, b) => countTokens(b.rendered) - countTokens(a.rendered));
  const noteFor = (leftOut: number) => `${leftOut} hunks left out to fit the ${maxTokens} token review cap.`;
  const picked: string[] = [];
  let used = countTokens(noteFor(ranked.length));
  for (const hunk of ranked) {
    const cost = countTokens(hunk.rendered);
    if (used + cost <= maxTokens) {
      picked.push(hunk.rendered);
      used += cost;
    }
  }
  const leftOutHunks = ranked.length - picked.length;
  if (picked.length === 0 && ranked.length > 0) {
    // One hunk alone is over the cap: keep its head so the reviewer still sees the start.
    const budgetChars = Math.max(0, Math.floor((maxTokens - countTokens(noteFor(leftOutHunks))) * 3.6));
    picked.push((ranked[0] as (typeof ranked)[number]).rendered.slice(0, budgetChars));
  }
  const text = leftOutHunks > 0 ? `${picked.join('\n')}\n${noteFor(leftOutHunks)}` : picked.join('\n');
  return { text, includedHunks: picked.length, leftOutHunks };
}
