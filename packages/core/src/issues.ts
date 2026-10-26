import type { z } from 'zod';

/** One line per zod issue, each naming the field: `summary: Too big: expected string to have <=400 characters`. */
export function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`).join('\n');
}
