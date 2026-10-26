// Paths a task's own words name: shared by the planner's memory (R-036) and the plan-time test lock (R-029).

/** Paths a task names before it has touched any: its context files and the paths written in its goal and acceptance. */
export function namedFiles(task: { goal: string; acceptance: string[] }, context: unknown): string[] {
  const out = new Set<string>();
  const files = (context as { files?: Array<{ path?: unknown }> } | null)?.files;
  if (Array.isArray(files)) for (const f of files) if (typeof f.path === 'string') out.add(f.path);
  for (const m of `${task.goal}\n${task.acceptance.join('\n')}`.matchAll(/(?:^|[\s`'"(])((?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,5})(?=$|[\s`'"),.:;])/gim)) {
    const path = m[1] as string;
    if (path.includes('/') || /\.(ts|tsx|js|json|md|py|go|rs|sql|yml|yaml|toml)$/.test(path)) out.add(path);
  }
  return [...out];
}
