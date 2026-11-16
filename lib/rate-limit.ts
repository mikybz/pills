/**
 * In-memory fixed-window rate limit. One container, so a Map is enough; it resets on
 * restart, which is fine for flood protection.
 */
const windows = new Map<string, { start: number; count: number }>();

export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) prune(now);
    return true;
  }
  w.count += 1;
  return w.count <= max;
}

/** Drops windows older than an hour (longer than any window in use). */
function prune(now: number) {
  for (const [k, w] of windows) if (now - w.start >= 3_600_000) windows.delete(k);
}
