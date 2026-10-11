/**
 * screenCache - one place to say "the screen may have changed".
 *
 * Reading the UI tree or running OCR is expensive, and a single click used to
 * do it several times for the same unchanged screen. Readers keep their result
 * for a moment; anything that acts on the screen (click, type, key, scroll,
 * focus) calls screenChanged() so nobody ever reads a stale answer after Rocky
 * has done something.
 */
const listeners = new Set();

/** Register a function that drops cached screen data. Returns an unsubscribe function. */
export function onScreenChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call after any action that can change what is on screen. */
export function screenChanged() {
  for (const fn of listeners) {
    try { fn(); } catch { /* a cache must never break an action */ }
  }
}

/**
 * Wrap an async reader with a short-lived cache plus de-duplication of
 * simultaneous identical requests. `key` separates different questions.
 */
export function cachedReader(read, { ttlMs = 1500, now = Date.now, shouldCache = (v) => v != null } = {}) {
  const entries = new Map(); // key -> { at, value } | { promise }
  onScreenChanged(() => entries.clear());

  return async function cached(key, ...args) {
    const hit = entries.get(key);
    if (hit?.promise) return hit.promise;
    if (hit && now() - hit.at < ttlMs) return hit.value;

    const promise = read(...args).then(
      (value) => {
        // Only remember good answers, and only if nothing invalidated us meanwhile.
        if (entries.get(key)?.promise === promise) {
          if (shouldCache(value)) entries.set(key, { at: now(), value });
          else entries.delete(key);
        }
        return value;
      },
      (err) => { entries.delete(key); throw err; }
    );
    entries.set(key, { promise });
    return promise;
  };
}
