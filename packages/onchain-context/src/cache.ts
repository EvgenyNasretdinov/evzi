/**
 * A tiny TTL cache.
 *
 * Exists because the Token API answers in ~10s on the free tier (measured
 * 2026-09-10: /tokens, /balances, /holders and /transfers all sit around
 * 10,000ms), which is far too slow to block a verdict the user is waiting on
 * before they sign. Slow sources are therefore fetched in the background and
 * read from here on subsequent lookups.
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

/** Read through memory, then the durable store. */
export async function cachedOrKickoffDurable<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T | undefined>,
  opts: { store?: DurableStore; keepAlive?: (p: Promise<unknown>) => void } = {},
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

  return undefined;
}

/** Test seam. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
}
