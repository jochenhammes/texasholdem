/**
 * Snap a raise-to amount to a "nice" multiple of `unit`, kept within
 * [min, max]. Anything that would leave less than one unit behind becomes
 * an all-in – rounding must never strand a few crumbs in the stack
 * (e.g. 1230 with unit 25 would otherwise round to 1225 and keep 5 chips).
 */
export function snapRaiseTo(v: number, unit: number, min: number, max: number): number {
  if (!Number.isFinite(v) || v >= max) return max;
  if (v <= min) return min;
  const r = Math.round(v / unit) * unit;
  if (max - r < unit) return max;
  return Math.max(min, r);
}
