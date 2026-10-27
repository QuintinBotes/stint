import { type SkillFrontmatter, SkillFrontmatterSchema } from '../schemas/skill';
import { countTokens } from '../tokens';
import { BASE64_PATTERN, CREDENTIAL_PATTERNS, HOST_PATTERN, SHEBANG_PATTERN, WARN_LINE_PATTERNS } from './patterns';

/** One file of a skill bundle as bytes, with no filesystem behind it. `mode` is a unix mode when the carrier has one. */
export type SkillBundleFile = { path: string; bytes: Uint8Array; mode?: number };

/** One thing the scan or the validator found. The card groups warns for acknowledgement. */
export type SkillFinding = { id: string; severity: 'block' | 'warn' | 'note'; file: string; line?: number; text: string };

/** The verdict on a bundle: normalized files, the parsed frontmatter, and every finding. */
export type SkillBundleCheck = {
  ok: boolean;
  /** The frontmatter name once SKILL.md parses; null before that. */
  id: string | null;
  frontmatter: SkillFrontmatter | null;
  body: string;
  /** The bundle with a single top folder stripped, sorted by path. */
  files: SkillBundleFile[];
  findings: SkillFinding[];
};

export const SKILL_LIMITS = { files: 64, fileBytes: 256 * 1024, totalBytes: 1024 * 1024, warnTokens: 5_000, maxTokens: 20_000 } as const;

const EXPECTED_TOP = new Set(['SKILL.md', 'scripts', 'references', 'assets', 'examples.md']);
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// --- a small frontmatter reader: the browser shape of parseSkillFrontmatter, for the flat YAML a SKILL.md holds ---

const scalar = (raw: string): unknown => {
  const text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  return text;
};

const flowItems = (inner: string): string[] => {
  const out: string[] = [];
  let current = '';
  let quote = '';
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
};

const value = (raw: string): unknown => {
  const text = raw.trim();
  if (text.startsWith('[') && text.endsWith(']')) return flowItems(text.slice(1, -1)).map(scalar);
  if (text.startsWith('{') && text.endsWith('}')) {
    const map: Record<string, unknown> = {};
    for (const part of flowItems(text.slice(1, -1))) {
      const at = part.indexOf(':');
      if (at > 0) map[String(scalar(part.slice(0, at)))] = scalar(part.slice(at + 1));
    }
    return map;
  }
  return scalar(text);
};

/** The flat keys, flow values, block lists and one nested map a SKILL.md frontmatter uses. */
function parseFrontmatterYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!line.trim() || line.trim().startsWith('#') || /^\s/.test(line)) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    const rest = (match[2] as string).trim();
    if (rest) {
      out[key] = value(rest);
      continue;
    }
    const children: string[] = [];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] as string)) children.push(lines[++i] as string);
    if (children.length && children.every((c) => /^\s*-\s/.test(c))) out[key] = children.map((c) => scalar(c.replace(/^\s*-\s*/, '')));
    else if (children.length) {
      const map: Record<string, unknown> = {};
      for (const child of children) {
        const inner = /^\s+([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/.exec(child);
        if (inner) map[inner[1] as string] = scalar(inner[2] as string);
      }
      out[key] = map;
    }
  }
  return out;
}

/** Splits SKILL.md the way parseSkillFrontmatter does, without a YAML library. */
function splitSkillMarkdown(md: string): { data: Record<string, unknown>; body: string } | { error: string } {
  let text = md.charCodeAt(0) === 0xfeff ? md.slice(1) : md;
  const fence = /^---[ \t]*\r?\n/;
  const emptyPair = /^---[ \t]*\r?\n---[ \t]*\r?\n/;
  if (emptyPair.test(text)) {
    text = text.replace(emptyPair, '');
    if (!fence.test(text)) text = `---\n${text}`;
  }
  if (!fence.test(text)) return { error: 'SKILL.md has no frontmatter. Start the file with a --- block that holds name and description.' };
  const rest = text.replace(fence, '');
  const end = rest.search(/^---[ \t]*$/m);
  if (end < 0) return { error: 'SKILL.md frontmatter is not closed. End it with a --- line before the body.' };
  return { data: parseFrontmatterYaml(rest.slice(0, end)), body: rest.slice(end).replace(/^---[ \t]*\r?\n?/, '') };
}

const decode = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

const modeType = (mode: number | undefined): number => (mode === undefined ? 0 : mode & 0o170000);

/** The paths with a single shared top folder removed, when no SKILL.md sits at the root. */
function stripped(files: SkillBundleFile[]): SkillBundleFile[] {
  if (files.some((f) => f.path === 'SKILL.md')) return files;
  const tops = new Set(files.map((f) => f.path.split('/')[0] as string));
  if (tops.size !== 1) return files;
  const top = [...tops][0] as string;
  if (!files.every((f) => f.path.startsWith(`${top}/`)) || !files.some((f) => f.path === `${top}/SKILL.md`)) return files;
  return files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) }));
}

/**
 * Checks a skill bundle before anything touches disk (R-060). Browser-safe: bytes in, verdict out.
 * A block finding refuses the bundle; a warn rides to the proposal card; a note only informs.
 */
export function validateSkillBundle(input: SkillBundleFile[]): SkillBundleCheck {
  const findings: SkillFinding[] = [];
  const block = (id: string, file: string, text: string) => findings.push({ id, severity: 'block', file, text });

  const files: SkillBundleFile[] = [];
  for (const f of input) {
    if (f.path.endsWith('/') || modeType(f.mode) === 0o040000) continue;
    files.push(f);
  }

  for (const f of files) {
    const path = f.path;
    if (path.includes('\0')) block('bad-path', path, `${path} holds a NUL byte. Rename the file and import again.`);
    else if (path.includes('\\')) block('bad-path', path, `${path} uses backslashes. Use forward slashes in bundle paths and import again.`);
    else if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) block('bad-path', path, `${path} is an absolute path. Bundle paths are relative to the skill folder; fix the path and import again.`);
    else if (path.split('/').includes('..') || path.split('/').includes('.')) block('bad-path', path, `${path} reaches outside the skill folder. Remove the dot segment and import again.`);
    const type = modeType(f.mode);
    if (type !== 0 && type !== 0o100000) block('not-a-file', path, `${path} is not a regular file (a link, device or pipe). Replace it with the file itself and import again.`);
    if (f.bytes.length > SKILL_LIMITS.fileBytes) block('file-too-large', path, `${path} is ${f.bytes.length} bytes; one file may be at most ${SKILL_LIMITS.fileBytes} bytes. Shorten or split it and import again.`);
    if (!path.startsWith('assets/') && !path.includes('/assets/') && decode(f.bytes) === null && !path.endsWith('/')) {
      block('not-utf8', path, `${path} is not valid UTF-8 text. Text outside assets/ must be UTF-8; convert it, or move binary data under assets/.`);
    }
  }
  if (files.length > SKILL_LIMITS.files) block('too-many-files', files[SKILL_LIMITS.files]?.path ?? 'SKILL.md', `The bundle holds ${files.length} files; at most ${SKILL_LIMITS.files} are allowed. Remove files the skill does not need.`);
  const total = files.reduce((sum, f) => sum + f.bytes.length, 0);
  if (total > SKILL_LIMITS.totalBytes) block('bundle-too-large', 'SKILL.md', `The bundle is ${total} bytes; at most ${SKILL_LIMITS.totalBytes} bytes are allowed in total. Remove files the skill does not need.`);

  const normalized = stripped(files).sort((a, b) => a.path.localeCompare(b.path));
  const skillFiles = normalized.filter((f) => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'));
  let frontmatter: SkillFrontmatter | null = null;
  let body = '';
  if (skillFiles.length === 0) {
    block('missing-skill-md', normalized[0]?.path ?? 'SKILL.md', 'The bundle holds no SKILL.md at its root. Add one with name and description in its frontmatter.');
  } else if (skillFiles.length > 1 || skillFiles[0]?.path !== 'SKILL.md') {
    block('multiple-skill-md', skillFiles[0]?.path ?? 'SKILL.md', 'The bundle must hold exactly one SKILL.md, at its root. Remove or rename the others.');
  } else {
    const text = decode(skillFiles[0]?.bytes ?? new Uint8Array());
    if (text === null) block('not-utf8', 'SKILL.md', 'SKILL.md is not valid UTF-8 text. Convert it to UTF-8 and import again.');
    else {
      const split = splitSkillMarkdown(text);
      if ('error' in split) block('frontmatter', 'SKILL.md', split.error);
      else {
        body = split.body;
        const parsed = SkillFrontmatterSchema.safeParse(split.data);
        if (!parsed.success) {
          for (const issue of parsed.error.issues.slice(0, 8)) {
            const field = issue.path.join('.') || 'frontmatter';
            block('frontmatter', 'SKILL.md', `Frontmatter ${field}: ${issue.message}. Fix SKILL.md and import again.`);
          }
        } else {
          frontmatter = parsed.data;
          if (!NAME.test(parsed.data.name) || parsed.data.name.length > 64) {
            block('frontmatter', 'SKILL.md', `The name "${parsed.data.name}" is not a skill id. Use lowercase words joined by dashes, at most 64 characters.`);
          }
        }
        const tokens = countTokens(body);
        if (tokens > SKILL_LIMITS.maxTokens) block('body-too-large', 'SKILL.md', `The body runs to about ${tokens} tokens; at most ${SKILL_LIMITS.maxTokens} are allowed. Shorten the body; put detail in references/.`);
        else if (tokens > SKILL_LIMITS.warnTokens) findings.push({ id: 'body-too-large', severity: 'warn', file: 'SKILL.md', text: `The body runs to about ${tokens} tokens. Keep a skill body under ${SKILL_LIMITS.warnTokens} tokens so agents keep it in view; move detail to references/.` });
      }
    }
  }

  const seenTop = new Set<string>();
  for (const f of normalized) {
    const top = f.path.split('/')[0] as string;
    if (seenTop.has(top)) continue;
    seenTop.add(top);
    if (!EXPECTED_TOP.has(top)) findings.push({ id: 'unexpected-entry', severity: 'note', file: f.path, text: `${top} is not a place a skill usually keeps files (SKILL.md, scripts/, references/, assets/, examples.md). It imports as it is.` });
  }

  return { ok: !findings.some((f) => f.severity === 'block'), id: frontmatter?.name ?? null, frontmatter, body, files: normalized, findings };
}

/**
 * Scans a bundle for the risky shapes in patterns.ts (R-060). Scanned by pattern; this is not a
 * security review. Validation blocks ride along, so one call answers for the whole bundle.
 */
export function scanSkillBundle(input: SkillBundleFile[]): SkillFinding[] {
  const check = validateSkillBundle(input);
  const findings = [...check.findings];
  for (const f of check.files) {
    const text = decode(f.bytes);
    if (text === null) {
      findings.push({ id: 'binary-asset', severity: 'note', file: f.path, text: `${f.path} is binary data, ${f.bytes.length} bytes. It is never read as instructions.` });
      continue;
    }
    if (f.path.startsWith('scripts/') || SHEBANG_PATTERN.pattern.test(text)) {
      findings.push({ id: 'executable-script', severity: 'warn', file: f.path, text: SHEBANG_PATTERN.text });
    }
    const hosts = new Set<string>();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      for (const p of CREDENTIAL_PATTERNS) {
        if (p.pattern.test(line)) findings.push({ id: p.id, severity: 'block', file: f.path, line: i + 1, text: p.text });
      }
      for (const p of WARN_LINE_PATTERNS) {
        if (p.pattern.test(line)) findings.push({ id: p.id, severity: 'warn', file: f.path, line: i + 1, text: p.text });
      }
      if (BASE64_PATTERN.pattern.test(line)) findings.push({ id: BASE64_PATTERN.id, severity: 'warn', file: f.path, line: i + 1, text: BASE64_PATTERN.text });
      for (const m of line.matchAll(HOST_PATTERN.pattern)) {
        const host = (m[1] as string).toLowerCase();
        if (hosts.has(host)) continue;
        hosts.add(host);
        findings.push({ id: HOST_PATTERN.id, severity: 'note', file: f.path, line: i + 1, text: `Names the external host ${host}. Stint does not call it; an agent following this skill might.` });
      }
    }
  }
  return findings;
}
