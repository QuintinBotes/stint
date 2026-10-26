/** Every model Stint calls is a Meta model; what differs between runs is the agent that drove it. */
export type Mark = 'meta' | 'anthropic' | 'local';

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

export type Agent = { name: string; mark: Mark; letter: string };

/** Coding agents are named by their harness; plan and review calls are named by the model that answered. */
export function agentOf(adapter: string | null | undefined, host?: string | null, model?: string | null): Agent {
  if (adapter === 'muse-code') return { name: 'Muse Code', mark: 'meta', letter: 'M' };
  if (adapter === 'claude-code') return { name: 'Claude Code harness', mark: 'anthropic', letter: 'C' };
  if (adapter === 'openai-compatible' && host === 'ollama') return { name: model ? `${modelName(model)}, local` : 'Local model', mark: 'local', letter: 'L' };
  if (adapter === 'openai-compatible') return { name: model ? modelName(model) : hostName(host), mark: 'meta', letter: 'M' };
  if (adapter === 'replay') return { name: 'Replay', mark: 'local', letter: 'R' };
  return { name: adapter ?? 'daemon', mark: 'local', letter: (adapter ?? 'd').slice(0, 1).toUpperCase() };
}

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

export const markColor: Record<Mark, string> = {
  meta: 'var(--vendor-meta)',
  anthropic: 'var(--vendor-anthropic)',
  local: 'var(--vendor-local)',
};

export const ROLE_NAMES: Record<string, string> = { planner: 'plans', implementer: 'builds', reviewer: 'reviews' };

/** Replayed events carry their place in the story; show that instead of the moment they were appended. */
export function storyClock(payload: Record<string, unknown>): string | null {
  const at = payload.replayAt;
  if (typeof at !== 'number') return null;
  return `${Math.floor(at / 60_000)}:${String(Math.floor((at % 60_000) / 1000)).padStart(2, '0')}`;
}
