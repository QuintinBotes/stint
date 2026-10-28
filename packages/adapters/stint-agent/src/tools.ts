import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { checkCommand, checkPath } from './refusals';

export const OUTPUT_CAP = 8 * 1024;
const BASH_CAP_MS = 120_000;

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });

/** The six tools the Stint agent has, as OpenAI-style function definitions. */
export const TOOLS = [
  { name: 'read_file', description: 'Read a text file in the repository. Lines are numbered.', parameters: obj({ path: { type: 'string' }, offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1 } }, ['path']) },
  { name: 'write_file', description: 'Create or overwrite a text file in the repository.', parameters: obj({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']) },
  { name: 'edit_file', description: 'Replace one exact, unique occurrence of old_text with new_text in a file.', parameters: obj({ path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, ['path', 'old_text', 'new_text']) },
  { name: 'list_dir', description: 'List a directory in the repository.', parameters: obj({ path: { type: 'string' } }, ['path']) },
  { name: 'grep', description: 'Search the repository for a regular expression; returns file:line: text.', parameters: obj({ pattern: { type: 'string' }, path: { type: 'string' } }, ['pattern']) },
  { name: 'bash', description: 'Run a shell command in the repository root, for example the tests. 120 s cap.', parameters: obj({ command: { type: 'string' } }, ['command']) },
].map((f) => ({ type: 'function' as const, function: f }));

export type ToolName = 'read_file' | 'write_file' | 'edit_file' | 'list_dir' | 'grep' | 'bash';

/**
 * Checks one tool call against the definitions the model was given: known tool, JSON arguments, every
 * required argument there with the right type. Local models get this wrong often; a bad call is never
 * run, the model is told what was wrong and calls again (R-048).
 */
export function checkCall(name: string, raw: string): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  const def = TOOLS.find((t) => t.function.name === name)?.function;
  if (!def) return { ok: false, reason: `there is no tool named ${name}; the tools are ${TOOLS.map((t) => t.function.name).join(', ')}` };
  let args: unknown;
  try {
    args = JSON.parse(raw || '{}');
  } catch {
    return { ok: false, reason: 'the arguments are not valid JSON' };
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: 'the arguments must be a JSON object' };
  const a = args as Record<string, unknown>;
  const props = def.parameters.properties as Record<string, { type: string }>;
  for (const k of def.parameters.required) if (a[k] === undefined || a[k] === null) return { ok: false, reason: `${k} is required` };
  for (const [k, v] of Object.entries(a)) {
    const want = props[k]?.type;
    if (!want) return { ok: false, reason: `${name} takes no argument ${k}` };
    if (want === 'string' && typeof v !== 'string') return { ok: false, reason: `${k} must be a string` };
    if (want === 'integer' && !Number.isInteger(v)) return { ok: false, reason: `${k} must be a whole number` };
  }
  return { ok: true, args: a };
}
export type ToolOutcome = { ok: boolean; output: string; refused?: string; summary: string; args: Record<string, unknown> };

const cap = (s: string) => (s.length > OUTPUT_CAP ? `${s.slice(0, OUTPUT_CAP)}\n[output truncated at ${OUTPUT_CAP} bytes]` : s);
export const SKIP = new Set(['node_modules', '.git', 'dist', '.stint']);

const GREP_CAP_MS = 5_000;
const GREP_MAX_PATTERN = 500;

/** The search runs in a worker with JavaScript regex semantics; a pattern that runs over the cap ends it (R-013). */
async function grep(root: string, pattern: string, under: string): Promise<{ ok: boolean; output: string }> {
  if (pattern.length > GREP_MAX_PATTERN) return { ok: false, output: `the pattern is longer than ${GREP_MAX_PATTERN} characters; make it shorter` };
  try {
    new RegExp(pattern);
  } catch (err) {
    return { ok: false, output: `the pattern is not a valid regular expression: ${err instanceof Error ? err.message : String(err)}` };
  }
  const worker = new Worker(new URL('./grep.worker.ts', import.meta.url).href);
  return new Promise((resolve) => {
    const done = (r: { ok: boolean; output: string }) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, output: 'the pattern took too long; make it simpler' }), GREP_CAP_MS);
    worker.onmessage = (e: MessageEvent<{ hits?: string[]; error?: string }>) =>
      done(e.data.error !== undefined ? { ok: false, output: `error: ${e.data.error}` } : { ok: true, output: e.data.hits?.length ? e.data.hits.join('\n') : 'no matches' });
    worker.onerror = (e) => done({ ok: false, output: `error: ${e.message}` });
    worker.postMessage({ root, pattern, under });
  });
}

function bash(command: string, cwd: string, env: Record<string, string>, signal: AbortSignal, wrap?: (argv: string[]) => string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((done) => {
    const argv = ['/bin/sh', '-c', command];
    const [cmd, ...args] = (wrap?.(argv) ?? argv) as [string, ...string[]];
    const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const add = (b: Buffer) => {
      if (output.length < OUTPUT_CAP * 2) output += b.toString();
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(kill, BASH_CAP_MS);
    signal.addEventListener('abort', kill, { once: true });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', kill);
      done({ code, output });
    });
  });
}

/** Runs one tool call after the refusal set has checked it. Every path stays inside the worktree. */
export async function runTool(name: string, raw: Record<string, unknown>, worktree: string, env: Record<string, string>, signal: AbortSignal, wrap?: (argv: string[]) => string[]): Promise<ToolOutcome> {
  const args = raw;
  const refuse = (reason: string): ToolOutcome => ({ ok: false, refused: reason, output: `Refused by Stint: ${reason}.`, summary: `refused: ${reason}`, args });
  try {
    if (name === 'bash') {
      const r = checkCommand(args.command, worktree, env.TMPDIR);
      if (r) return refuse(r.reason);
      const res = await bash(String(args.command), worktree, env, signal, wrap);
      const out = cap(res.output);
      const last = res.output.trim().split('\n').filter(Boolean).at(-1) ?? '';
      return { ok: res.code === 0, output: `exit ${res.code}\n${out}`, summary: `exit ${res.code}${last ? `: ${last.slice(0, 160)}` : ''}`, args };
    }
    const p = checkPath(worktree, name === 'grep' ? (args.path ?? '.') : args.path);
    if ('reason' in p) return refuse(p.reason);
    const full = join(worktree, p.path);
    switch (name) {
      case 'read_file': {
        const lines = (await readFile(full, 'utf8')).split('\n');
        const from = Math.max(1, Number(args.offset ?? 1));
        const slice = lines.slice(from - 1, from - 1 + Number(args.limit ?? 400));
        return { ok: true, output: cap(slice.map((l, i) => `${from + i}|${l}`).join('\n')), summary: `${lines.length} lines`, args };
      }
      case 'write_file': {
        const content = String(args.content ?? '');
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, content);
        return { ok: true, output: `wrote ${content.split('\n').length} lines to ${p.path}`, summary: `wrote ${content.split('\n').length} lines`, args: { path: p.path } };
      }
      case 'edit_file': {
        const text = await readFile(full, 'utf8');
        const oldText = String(args.old_text ?? '');
        const count = oldText ? text.split(oldText).length - 1 : 0;
        if (count !== 1) return { ok: false, output: `old_text occurs ${count} times in ${p.path}; it must occur exactly once`, summary: `old_text found ${count} times`, args: { path: p.path } };
        await writeFile(full, text.replace(oldText, String(args.new_text ?? '')));
        return { ok: true, output: `edited ${p.path}`, summary: 'edited', args: { path: p.path } };
      }
      case 'list_dir': {
        const entries = await readdir(full, { withFileTypes: true });
        const names = entries.filter((e) => !SKIP.has(e.name)).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return { ok: true, output: names.join('\n') || '(empty)', summary: `${names.length} entries`, args };
      }
      case 'grep': {
        const r = await grep(worktree, String(args.pattern), p.path);
        if (!r.ok) return { ok: false, output: r.output, summary: r.output.slice(0, 120), args };
        return { ok: true, output: cap(r.output), summary: r.output === 'no matches' ? 'no matches' : `${r.output.split('\n').length} matches`, args };
      }
      default:
        return { ok: false, output: `unknown tool ${name}`, summary: 'unknown tool', args };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output: `error: ${message}`, summary: `error: ${message.slice(0, 120)}`, args };
  }
}
