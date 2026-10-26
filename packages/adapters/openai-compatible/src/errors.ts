export type HostErrorReason = '429' | '5xx' | 'timeout' | 'no_key' | string;

/** A host level failure the chain walker can fall back from. The message never carries a key. */
export class HostError extends Error {
  readonly reason: HostErrorReason;
  readonly host: string;
  readonly status?: number;

  constructor(host: string, reason: HostErrorReason, message?: string, status?: number) {
    super(message ?? `host ${host} failed: ${reason}`);
    this.name = 'HostError';
    this.host = host;
    this.reason = reason;
    if (status !== undefined) this.status = status;
  }
}

/** The model answered twice with output that does not validate. The chain walker falls back. */
export class StructuredOutputError extends Error {
  readonly errors: string;
  readonly host: string;
  readonly model?: string;
  readonly reason = 'invalid_output';

  constructor(host: string, errors: string, model?: string) {
    super(`host ${host} returned output that does not validate: ${errors}`);
    this.name = 'StructuredOutputError';
    this.host = host;
    this.errors = errors;
    if (model !== undefined) this.model = model;
  }
}
