/** The clock a bucket waits on; tests pass a fake one that only moves when the bucket sleeps. */
export type BenchClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export const realClock: BenchClock = {
  now: () => Date.now(),
  sleep: (ms) => Bun.sleep(ms),
};

const MINUTE_MS = 60_000;

type Stock = { full: number; ratePerMs: number; left: number };

function stock(perMinute: number | undefined): Stock | null {
  if (!perMinute || !Number.isFinite(perMinute) || perMinute <= 0) return null;
  return { full: perMinute, ratePerMs: perMinute / MINUTE_MS, left: perMinute };
}

/**
 * One host's rate limit as two token buckets, requests and tokens (R-055). A call that finds a
 * bucket short waits for it to refill; it never fails for an empty bucket. Calls are taken in
 * the order they arrive, so a later call cannot pass one that is already waiting. A call bigger
 * than a whole minute of tokens goes once the bucket is full and leaves it overdrawn, so the
 * next call waits the longer for it.
 */
export class TokenBucket {
  private requests: Stock | null;
  private tokens: Stock | null;
  private lastRefill: number;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    limits: { tpm?: number; rpm?: number },
    private clock: BenchClock = realClock,
  ) {
    this.requests = stock(limits.rpm);
    this.tokens = stock(limits.tpm);
    this.lastRefill = this.clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = Math.max(0, now - this.lastRefill);
    this.lastRefill = now;
    for (const s of [this.requests, this.tokens]) {
      if (s) s.left = Math.min(s.full, s.left + elapsed * s.ratePerMs);
    }
  }

  /** The wait for both buckets to cover one call of `tokens` estimated tokens, or 0 when they do. */
  private waitMs(tokens: number): number {
    let wait = 0;
    const due = (s: Stock | null, need: number) => {
      if (!s) return;
      // an ask bigger than the bucket ever holds is covered once the bucket is full
      const needed = Math.min(need, s.full);
      if (s.left < needed) wait = Math.max(wait, (needed - s.left) / s.ratePerMs);
    };
    due(this.requests, 1);
    due(this.tokens, Math.max(0, tokens));
    return wait;
  }

  private async take(tokens: number): Promise<void> {
    for (;;) {
      this.refill();
      const wait = this.waitMs(tokens);
      if (wait <= 0) break;
      await this.clock.sleep(Math.max(1, Math.ceil(wait)));
    }
    if (this.requests) this.requests.left -= 1;
    if (this.tokens) this.tokens.left -= Math.max(0, tokens);
  }

  /** Waits until this host can take one more call of about `tokens` tokens, then counts it. */
  acquire(tokens = 0): Promise<void> {
    const taken = this.tail.then(() => this.take(tokens));
    this.tail = taken.then(
      () => undefined,
      () => undefined,
    );
    return taken;
  }
}

export type HostBuckets = {
  /** Waits for the named host's bucket; a host with no tpm or rpm in config never waits. */
  acquire: (host: string, config: { tpm?: number; rpm?: number } | undefined, tokens: number) => Promise<void>;
};

/** The buckets of one bench run, one per host, shared by every concurrent unit. */
export function hostBuckets(clock: BenchClock = realClock): HostBuckets {
  const buckets = new Map<string, TokenBucket>();
  return {
    acquire: (host, config, tokens) => {
      let bucket = buckets.get(host);
      if (!bucket) buckets.set(host, (bucket = new TokenBucket({ ...(config?.tpm ? { tpm: config.tpm } : {}), ...(config?.rpm ? { rpm: config.rpm } : {}) }, clock)));
      return bucket.acquire(tokens);
    },
  };
}
