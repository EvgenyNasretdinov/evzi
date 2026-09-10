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
  }

  return undefined;
}

/** Wait for any background fetches to settle. For tests and for warming a demo. */
export async function drainInflight(): Promise<void> {
  await Promise.allSettled([...inflight.values()]);
}

/** Test seam. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
}
