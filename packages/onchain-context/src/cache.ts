/**
 * A tiny TTL cache.
 *
 * Written when the Token API answered in ~10s on the free tier (measured
 * 2026-09-10 across /tokens, /balances, /holders and /transfers, all around
 * 10,000ms) — far too slow to block a verdict someone is waiting on before they
 * sign, so those lookups ran in the background and were read from here on the
 * next request.
 *
 * Re-measured 2026-09-12: 0.5–0.7s warm, ~2.5s on a cold contract. Callers may
 * now wait for the fetch by passing `waitMs`, and the background path remains
 * as the fallback for when an upstream is having a bad day. The cache is still
 * worth having: it keeps repeat lookups free and absorbs the cold first hit.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

/** In-flight background fetches, so N concurrent misses cause one request. */
const inflight = new Map<string, Promise<unknown>>();

export function cacheGet<T>(key: string, now: number = Date.now()): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number, now: number = Date.now()): void {
  store.set(key, { value, expiresAt: now + ttlMs });
}

/**
 * Return the cached value if present. On a miss, start the fetch in the
 * background, remember it in the cache when it lands, and return `undefined`
 * immediately — the caller must not wait.
 */
export function cachedOrKickoff<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T | undefined>,
  /**
   * Serverless runtimes kill work that outlives the response. On Cloudflare
   * Workers the background fetch is terminated the moment the handler returns
   * unless it is registered here, so the cache would never fill and every
   * verdict would be degraded forever. Node callers can leave this undefined.
   */
  keepAlive?: (p: Promise<unknown>) => void,
): T | undefined {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;

  if (!inflight.has(key)) {
    const p = fetcher()
      .then((value) => {
        if (value !== undefined) cacheSet(key, value, ttlMs);
        return value;
      })
      .catch(() => undefined)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    keepAlive?.(p);
  }

  return undefined;
}

/** Wait for any background fetches to settle. For tests and for warming a demo. */
export async function drainInflight(): Promise<void> {
  await Promise.allSettled([...inflight.values()]);
}

/**
 * A durable store the cache can fall back on, injected by the caller.
 *
 * The in-memory map above is per-process, which is fine in Node and useless on
 * a serverless runtime where each request may run in a fresh isolate. Callers
 * that have somewhere durable to write — Workers KV, Redis — supply it here.
 */
export interface DurableStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * Read through memory, then the durable store.
 *
 * With `waitMs` the caller waits for a miss to be fetched, up to that budget;
 * without it, or when the budget runs out, the fetch continues in the
 * background and fills the cache for the next lookup. Either way the caller
 * gets an answer within the budget, and no upstream can hold a verdict.
 */
export async function cachedOrKickoffDurable<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T | undefined>,
  opts: {
    store?: DurableStore;
    keepAlive?: (p: Promise<unknown>) => void;
    waitMs?: number;
  } = {},
): Promise<T | undefined> {
  const local = cacheGet<T>(key);
  if (local !== undefined) return local;

  if (opts.store) {
    try {
      const raw = await opts.store.get(key);
      if (raw !== null) {
        const value = JSON.parse(raw) as T;
        cacheSet(key, value, ttlMs);
        return value;
      }
    } catch {
      // A cache read failing must never take down a verdict.
    }
  }

  if (!inflight.has(key)) {
    const p = fetcher()
      .then(async (value) => {
        if (value !== undefined) {
          cacheSet(key, value, ttlMs);
          if (opts.store) {
            try {
              await opts.store.put(key, JSON.stringify(value), Math.ceil(ttlMs / 1000));
            } catch {
              // Same: a write failure is not worth failing the request over.
            }
          }
        }
        return value;
      })
      .catch(() => undefined)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    opts.keepAlive?.(p);
  }

  if (!opts.waitMs) return undefined;

  // Wait for the in-flight fetch, but never past the budget: the point of the
  // background path is that a slow upstream costs the caller nothing.
  return Promise.race([
    inflight.get(key) as Promise<T | undefined>,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), opts.waitMs)),
  ]).catch(() => undefined);
}

/** Test seam. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
}
