// The scan's pattern lists, in one module so they can grow without touching the scanner (R-060).
// A finding never quotes the text it matched: a matched credential stays out of every record.

/** One named pattern. `text` is what the proposal card says about a match. */
export type SkillPattern = { id: string; pattern: RegExp; text: string };

const re = (source: string, flags = '') => new RegExp(source, flags);

/** Credential shapes. The first reuses the scrub pattern the packet builder applies to agent words. */
export const CREDENTIAL_PATTERNS: SkillPattern[] = [
  {
    id: 'credential-assignment',
    pattern: re('\\b([A-Z][A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=\\S+'),
    text: 'A credential assignment (a key, token, secret or password with a value). Remove the value; skills are committed and read by every agent.',
  },
  {
    id: 'credential-key',
    pattern: re('\\b(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\\b'),
    text: 'A value shaped like an API key or access token. Remove it; skills are committed and read by every agent.',
  },
  {
    id: 'credential-private-key',
    pattern: re('-----BEGIN( [A-Z]+)? PRIVATE KEY-----'),
    text: 'A private key block. Remove it; skills are committed and read by every agent.',
  },
  {
    id: 'credential-bearer',
    pattern: re('\\bBearer\\s+[A-Za-z0-9._~+/=-]{20,}'),
    text: 'A bearer token value. Remove it; skills are committed and read by every agent.',
  },
];

/** Instructions to fetch remote code and run it. */
export const FETCH_AND_RUN_PATTERNS: SkillPattern[] = [
  {
    id: 'fetch-and-run',
    pattern: re('\\b(curl|wget)\\b[^\\n]*\\|\\s*(sudo\\s+)?(sh|bash|zsh)\\b', 'i'),
    text: 'Downloads remote code and pipes it to a shell. Read that code first, or remove this step.',
  },
  {
    id: 'fetch-and-run-subshell',
    pattern: re('(\\$\\(|`)\\s*(curl|wget)\\b', 'i'),
    text: 'Runs downloaded output as a command substitution. Read that code first, or remove this step.',
  },
  {
    id: 'fetch-and-run-eval',
    pattern: re('\\beval\\b[^\\n]*(fetch|curl|wget|https?://)', 'i'),
    text: 'Evaluates fetched text as code. Read that code first, or remove this step.',
  },
];

/** Instructions to read files that hold credentials. */
export const CREDENTIAL_PATH_PATTERNS: SkillPattern[] = [
  { id: 'reads-ssh', pattern: re('(~|\\$HOME)/\\.ssh\\b|\\bid_(rsa|ed25519|ecdsa)\\b'), text: 'Points at SSH keys. A skill should not need private keys; remove this or say why.' },
  { id: 'reads-env-file', pattern: re('(^|[\\s`\'"(])\\.env(\\.[A-Za-z]+)?\\b'), text: 'Points at an env file, which usually holds keys. Name the one variable you need instead of the file.' },
  { id: 'reads-cloud-credentials', pattern: re('\\.aws/credentials|\\.config/gcloud|\\.azure\\b|application_default_credentials|service[-_ ]account(\\.json| key)', 'i'), text: 'Points at cloud credential files. A skill should not need them; remove this or say why.' },
];

/** Instructions to send data out to a URL. */
export const SEND_DATA_PATTERNS: SkillPattern[] = [
  {
    id: 'sends-data-curl',
    pattern: re('\\b(curl|wget)\\b[^\\n]*(-d\\b|--data|--form|-X\\s*(POST|PUT|PATCH))', 'i'),
    text: 'Sends data to a URL with curl or wget. Check the destination and what is sent.',
  },
  {
    id: 'sends-data-phrase',
    pattern: re('\\b(send|post|upload|exfiltrate|phone home)\\b[^\\n]*https?://', 'i'),
    text: 'Tells the agent to send data to a URL. Check the destination and what is sent.',
  },
  {
    id: 'sends-data-fetch',
    pattern: re('\\bfetch\\s*\\(\\s*[`\'"]https?://', 'i'),
    text: 'Calls a URL from code. Check the destination and what is sent.',
  },
];

/** Phrases that try to override the instructions already in force. */
export const OVERRIDE_PATTERNS: SkillPattern[] = [
  { id: 'overrides-ignore-previous', pattern: re('\\bignore\\b[^\\n]*\\b(previous|prior|above|earlier)\\b[^\\n]*\\b(instruction|direction|rule|prompt)?', 'i'), text: 'Tells the agent to ignore earlier instructions. A skill adds to the task prompt; it does not replace it.' },
  { id: 'overrides-disregard-system', pattern: re('\\b(disregard|ignore|override|forget)\\b[^\\n]*\\bsystem\\b', 'i'), text: 'Tells the agent to set the system instructions aside. A skill adds to the task prompt; it does not replace it.' },
  { id: 'overrides-new-instructions', pattern: re('\\b(new|real|actual) (system )?(instructions|prompt) (are|is|follow)\\b', 'i'), text: 'Claims to replace the instructions in force. A skill adds to the task prompt; it does not replace it.' },
];

/** A base64 run over 1 KB of characters: payload the reader cannot see. */
export const BASE64_PATTERN: SkillPattern = {
  id: 'base64-run',
  pattern: re('[A-Za-z0-9+/]{1024,}={0,2}'),
  text: 'A base64 run over 1 KB. Decode it and read what it holds, or remove it.',
};

/** A shebang line: the file asks to be run. */
export const SHEBANG_PATTERN: SkillPattern = {
  id: 'executable-script',
  pattern: re('^#![^\\n]*\\b(ba)?sh\\b|^#![^\\n]*/(env|bin)/'),
  text: 'An executable script. Stint does not run it, but an agent may; read it before approving.',
};

/** An external host named in the text. */
export const HOST_PATTERN: SkillPattern = {
  id: 'external-host',
  pattern: re('https?://([A-Za-z0-9.-]+\\.[A-Za-z]{2,})', 'gi'),
  text: 'Names an external host. Stint does not call it; an agent following this skill might.',
};

/** Every warn pattern that reads a line, in card order. */
export const WARN_LINE_PATTERNS: SkillPattern[] = [...FETCH_AND_RUN_PATTERNS, ...CREDENTIAL_PATH_PATTERNS, ...SEND_DATA_PATTERNS, ...OVERRIDE_PATTERNS];
