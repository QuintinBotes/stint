/**
 * Who drives: each agent is a driver with a three-letter code and a team livery. Stint's defaults run Meta's models;
 * a person can also bring another agent or model, which wears its own vendor's livery. A model served on this
 * machine drives for the local team, whoever made it, because what it costs and where it runs is what the team means.
 */
export type Mark = 'meta' | 'anthropic' | 'openai' | 'local' | 'other';

const MODEL_NAMES: Record<string, string> = {
  'muse-wonder-1.0': 'Muse Wonder 1.0',
  'muse-spark-1.3': 'Muse Spark 1.3',
  'muse-spark-1.2': 'Muse Spark 1.2',
  'muse-spark-open': 'Muse Spark Open',
  'muse-glimmer:30b-mlx': 'Muse Glimmer 30B',
};

export function modelName(model: string | null | undefined): string {
  if (!model) return 'model unknown';
  const short = model.includes('/') ? (model.split('/').at(-1) as string) : model;
  return MODEL_NAMES[short] ?? short;
}

/** `code` is the driver's three letters on every tag, bar and row; `name` says it in words beside them. */
export type Agent = { name: string; mark: Mark; code: string };

const isMeta = (model: string) => /(^|\/)(muse-|llama)/i.test(model);

/** The vendor a model belongs to, from its name, for a model reached through an OpenAI-compatible host. */
function modelMark(model: string | null | undefined): Mark {
  if (!model || isMeta(model)) return 'meta';
  if (/claude/i.test(model)) return 'anthropic';
  if (/(^|\/)(gpt|o\d|codex)/i.test(model)) return 'openai';
  return 'other';
}

/** Three letters for a model: WON for Muse Wonder, SPK for Muse Spark, SPO for Spark Open, GLI for Glimmer. */
function modelCode(model: string | null | undefined): string {
  const short = (model ?? '').split('/').at(-1) ?? '';
  if (/wonder/i.test(short)) return 'WON';
  if (/spark-open/i.test(short)) return 'SPO';
  if (/spark/i.test(short)) return 'SPK';
  if (/glimmer/i.test(short)) return 'GLI';
  if (/llama/i.test(short)) return 'LLA';
  return short.replace(/^muse-/i, '').replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'MOD';
}

/** Coding agents are named by their harness; plan and review calls are named by the model that answered. */
export function agentOf(adapter: string | null | undefined, host?: string | null, model?: string | null): Agent {
  if (adapter === 'muse-code') return { name: 'Muse Code', mark: 'meta', code: 'MUS' };
  // the Stint agent runs on Muse Spark unless someone points it at another model
  if (adapter === 'stint-agent') return { name: 'Stint agent', mark: host === 'ollama' ? 'local' : modelMark(model), code: 'STI' };
  if (adapter === 'openai-compatible' && host === 'ollama') return { name: model ? `${modelName(model)}, local` : 'Local model', mark: 'local', code: modelCode(model) };
  if (adapter === 'openai-compatible') return { name: model ? modelName(model) : hostName(host), mark: modelMark(model), code: modelCode(model) };
  if (adapter === 'claude-code') return { name: 'Claude Code', mark: 'anthropic', code: 'CLA' };
  if (adapter === 'codex') return { name: 'Codex', mark: 'openai', code: 'COD' };
  if (adapter === 'goose') return { name: 'Goose', mark: 'other', code: 'GOO' };
  if (adapter === 'opencode') return { name: 'OpenCode', mark: 'other', code: 'OPC' };
  if (adapter === 'gemini-cli') return { name: 'Gemini CLI', mark: 'other', code: 'GEM' };
  if (adapter === 'gemini-acp') return { name: 'Gemini CLI over ACP', mark: 'other', code: 'GMA' };
  if (adapter === 'aider') return { name: 'Aider', mark: 'other', code: 'AID' };
  if (adapter === 'replay') return { name: 'Replay', mark: 'local', code: 'RPL' };
  if (!adapter || adapter === 'daemon') return DAEMON;
  return { name: adapter, mark: 'other', code: adapter.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'AGT' };
}

export const DAEMON: Agent = { name: 'The daemon', mark: 'local', code: 'DMN' };
export const YOU: Agent = { name: 'You', mark: 'local', code: 'YOU' };

export function hostName(host: string | null | undefined): string {
  switch (host) {
    case 'meta-api':
      return 'Meta Model API';
    case 'baseten':
      return 'Baseten';
    case 'fireworks':
      return 'Fireworks';
    case 'modal':
      return 'Modal';
    case 'ollama':
      return 'Ollama on this machine';
    case 'local-cli':
      return 'local CLI';
    default:
      return host ?? 'host unknown';
  }
}

/** The team liveries from the design tokens. Colour lives on driver tags, stint bars and per-team chart segments only. */
export const markColor: Record<Mark, string> = {
  meta: 'var(--meta)',
  anthropic: 'var(--anthropic)',
  openai: 'var(--openai)',
  local: 'var(--local)',
  other: 'var(--ink-2)',
};

export const TEAM_NAMES: Record<Mark, string> = { meta: 'Meta', anthropic: 'Anthropic', openai: 'OpenAI', local: 'Local, on this machine', other: 'Other' };

/** The livery of a host's spend: the local host for the local team, else Meta's models wherever they are served. */
export const hostMark = (host: string): Mark => (host === 'ollama' || host === 'local-cli' ? 'local' : 'meta');

export const ROLE_NAMES: Record<string, string> = { planner: 'plans', implementer: 'builds', reviewer: 'reviews' };

/** Replayed events carry their place in the story; show that instead of the moment they were appended. */
export function storyClock(payload: Record<string, unknown>): string | null {
  const at = payload.replayAt;
  if (typeof at !== 'number') return null;
  return `${Math.floor(at / 60_000)}:${String(Math.floor((at % 60_000) / 1000)).padStart(2, '0')}`;
}

/** The names people know agents by; anything else shows its config id. */
export const ADAPTER_NAMES: Record<string, string> = {
  'muse-code': 'Muse Code',
  'stint-agent': 'Stint agent',
  replay: 'Replay',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  goose: 'goose',
  opencode: 'opencode',
  'gemini-cli': 'Gemini CLI',
  'gemini-acp': 'Gemini CLI over ACP',
  aider: 'Aider',
};

/** A task's car number: T-0042 is car 42. */
export const carNumber = (taskId: string): string => String(Number(/(\d+)$/.exec(taskId)?.[1] ?? '0')) || taskId;
