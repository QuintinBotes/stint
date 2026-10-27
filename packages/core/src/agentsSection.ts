/** The `## Stint` section of AGENTS.md is delimited, so init and approve rewrite it without touching the rest (R-014). */
export const SECTION_START = '<!-- stint:start -->';
export const SECTION_END = '<!-- stint:end -->';

/** The one line approve keeps current inside the section: the task that merged last (R-017). */
export const LATEST_MERGED = /^- The latest merged task: .*\n?/m;

export function latestMergedLine(id: string, title: string): string {
  return `- The latest merged task: ${id}, ${title.replace(/\s+/g, ' ').trim()}. Read what it decided and left out with \`stint packet ${id} --as prompt\`.`;
}

/** Puts the latest-merged line at the end of the section; text without the section comes back unchanged. */
export function withLatestMerged(text: string, line: string): string {
  if (!text.includes(SECTION_START) || !text.includes(SECTION_END)) return text;
  return text.replace(LATEST_MERGED, '').replace(SECTION_END, `${line}\n${SECTION_END}`);
}
