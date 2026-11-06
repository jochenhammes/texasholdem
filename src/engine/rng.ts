/**
 * Small, fast, seedable PRNG (sfc32). The full generator state is four uint32
 * numbers, so it can be stored inside the serializable table state. This makes
 * every hand reproducible (useful for tests, replays and a future
 * server-authoritative mode).
 */
export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  // splitmix32 to spread a single seed over the four state words
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const st: RngState = [next(), next(), next(), next()];
  // warm up
  for (let i = 0; i < 12; i++) nextUint32(st);
  return st;
}

/** Advances the state in place and returns a uint32. */
export function nextUint32(st: RngState): number {
  let [a, b, c, d] = st;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  st[0] = a >>> 0;
  st[1] = b;
  st[2] = c;
  st[3] = d;
  return t;
}

/** Uniform float in [0, 1). */
export function nextFloat(st: RngState): number {
  return nextUint32(st) / 4294967296;
}

/** Uniform integer in [0, n). */
export function nextInt(st: RngState, n: number): number {
  return Math.floor(nextFloat(st) * n);
}

/** In-place Fisher–Yates shuffle. */
export function shuffle<T>(arr: T[], st: RngState): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(st, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** A cryptographically random seed, when available. */
export function randomSeed(): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0];
  }
  return (Math.random() * 4294967296) >>> 0;
}
