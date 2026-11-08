import { RANKS, type Card } from '../engine/cards';
import { nextUint32, type RngState } from '../engine/rng';
import { classify, bucketOf, Bucket } from './handClass';
import { PREFLOP_ORDER } from './preflopRanking';

/**
 * Weighted hand ranges over all 1326 two-card combinations.
 * A range is a Float32Array of weights (0 = impossible, 1 = fully in range).
 */
export type Range = Float32Array;
export const COMBO_COUNT = 1326;

/** combo index → its two cards */
export const COMBO_A = new Uint8Array(COMBO_COUNT);
export const COMBO_B = new Uint8Array(COMBO_COUNT);
/** combo index → strength percentile pre-flop (0 = best hand, 1 = worst) */
export const COMBO_PCT = new Float32Array(COMBO_COUNT);
const COMBO_INDEX = new Int16Array(52 * 52).fill(-1);

const classIndex = new Map<string, number>(PREFLOP_ORDER.map((n, i) => [n, i]));

export function className(a: Card, b: Card): string {
  let r1 = a >> 2,
    r2 = b >> 2;
  if (r2 > r1) [r1, r2] = [r2, r1];
  if (r1 === r2) return RANKS[r1] + RANKS[r2];
  return RANKS[r1] + RANKS[r2] + ((a & 3) === (b & 3) ? 's' : 'o');
}

(function init() {
  // percentile band of every class, weighted by its number of combos
  const combosOf = (name: string) => (name.length === 2 ? 6 : name.endsWith('s') ? 4 : 12);
  const mid = new Float32Array(PREFLOP_ORDER.length);
  let acc = 0;
  PREFLOP_ORDER.forEach((name, i) => {
    const n = combosOf(name);
    mid[i] = (acc + n / 2) / COMBO_COUNT;
    acc += n;
  });
  let k = 0;
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++) {
      COMBO_A[k] = a;
      COMBO_B[k] = b;
      COMBO_INDEX[a * 52 + b] = k;
      COMBO_INDEX[b * 52 + a] = k;
      COMBO_PCT[k] = mid[classIndex.get(className(a, b))!];
      k++;
    }
})();

export const comboIndex = (a: Card, b: Card) => COMBO_INDEX[a * 52 + b];

/** Pre-flop strength percentile of a hand (0 = AA … 1 = 32o). */
export function handPct(a: Card, b: Card): number {
  return COMBO_PCT[comboIndex(a, b)];
}

export function fullRange(): Range {
  return new Float32Array(COMBO_COUNT).fill(1);
}

/** Zero out combos that contain any of the given (known) cards. */
export function removeCards(r: Range, dead: Card[]): Range {
  if (!dead.length) return r;
  const isDead = new Uint8Array(52);
  for (const c of dead) isDead[c] = 1;
  for (let k = 0; k < COMBO_COUNT; k++) if (isDead[COMBO_A[k]] || isDead[COMBO_B[k]]) r[k] = 0;
  return r;
}

export function totalWeight(r: Range): number {
  let s = 0;
  for (let k = 0; k < COMBO_COUNT; k++) s += r[k];
  return s;
}

/** Multiply every combo by a weight that depends on its pre-flop percentile. */
export function shapeByPct(r: Range, w: (pct: number) => number, floor = 0): Range {
  for (let k = 0; k < COMBO_COUNT; k++) if (r[k] > 0) r[k] *= Math.max(floor, w(COMBO_PCT[k]));
  return r;
}

/**
 * Real opponents (and loose bots) deviate from textbook ranges: every hand
 * keeps a small chance, and actions are taken less literally.
 */
export const PREFLOP_FLOOR = 0.1;
export const POSTFLOP_SOFTNESS = 0.6;
export const POSTFLOP_FLOOR = 0.2;

// ───────────── pre-flop strategy model ─────────────

/** Share of hands a solid player opens when `behind` players still have to act (unopened pot). */
export function openPct(behind: number): number {
  const table = [1, 0.48, 0.36, 0.24, 0.18, 0.15, 0.13, 0.11, 0.1, 0.09];
  return table[Math.min(Math.max(behind, 0), table.length - 1)];
}

/** Share of hands a short stack moves all-in with (roughly Nash-like, tighter with more players behind). */
export function pushPct(stackBB: number, behind: number): number {
  const base = Math.min(0.85, Math.max(0.08, 0.9 - 0.045 * stackBB));
  return Math.max(0.05, base * Math.max(0.35, 1 - 0.12 * Math.max(0, behind - 1)));
}

/** Share of hands that call an all-in of `shoveBB` big blinds. */
export function callShovePct(shoveBB: number): number {
  return Math.min(0.5, Math.max(0.08, 0.55 - 0.025 * shoveBB));
}

const fade = (pct: number, top: number, width = 0.05) => (pct <= top ? 1 : Math.max(0, 1 - (pct - top) / width));

/** Context of one pre-flop action, as reconstructed from the hand history. */
export interface PreflopActionCtx {
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
  raisesBefore: number;
  behind: number;
  isBigBlind: boolean;
  isSmallBlind: boolean;
  /** Effective stack in big blinds at the start of the hand. */
  stackBB: number;
  /** Raise/all-in amount in big blinds (raise-to). */
  toBB: number;
}

/**
 * Weight multiplier for a pre-flop action as a function of hand percentile.
 * `widen` > 1 for players observed to play looser than a solid regular.
 */
export function preflopActionWeight(ctx: PreflopActionCtx, widen = 1): (pct: number) => number {
  const W = (x: number) => Math.min(1, x * widen);
  const aggressive = ctx.type === 'raise' || ctx.type === 'bet' || ctx.type === 'allin';
  const shove = ctx.type === 'allin' && ctx.stackBB <= 25;
  if (shove && ctx.raisesBefore === 0) {
    const p = W(pushPct(ctx.stackBB, ctx.behind));
    return (pct) => fade(pct, p, 0.06);
  }
  if (aggressive) {
    if (ctx.raisesBefore === 0) {
      const p = W(openPct(ctx.behind) * (ctx.isSmallBlind ? 1.1 : 1));
      return (pct) => fade(pct, p);
    }
    if (ctx.raisesBefore === 1) {
      // 3-bet: value plus some bluffs
      const v = W(0.055),
        bl = W(0.14);
      return (pct) => (pct <= v ? 1 : pct <= bl ? 0.22 : 0.03);
    }
    const v = W(0.03),
      bl = W(0.07);
    return (pct) => (pct <= v ? 1 : pct <= bl ? 0.3 : 0.02);
  }
  if (ctx.type === 'call') {
    if (ctx.raisesBefore === 0) {
      const top = W(0.55);
      return (pct) => (pct <= 0.08 ? 0.3 : pct <= top ? 1 : 0.25); // limp
    }
    if (ctx.raisesBefore === 1) {
      const top = W(ctx.isBigBlind ? 0.5 : ctx.isSmallBlind ? 0.2 : 0.22);
      if (ctx.toBB >= ctx.stackBB * 0.6) {
        const p = W(callShovePct(ctx.toBB));
        return (pct) => fade(pct, p, 0.05);
      }
      // flat call: premiums mostly re-raise, the middle calls, trash rarely
      return (pct) => (pct <= 0.035 ? 0.35 : pct > top + 0.08 ? 0.06 : fade(pct, top, 0.08));
    }
    const top = W(0.09);
    return (pct) => (pct <= 0.02 ? 0.5 : pct <= top ? 1 : 0.05);
  }
  if (ctx.type === 'check') return (pct) => (pct <= 0.1 ? 0.3 : 1); // big blind checks its option
  return () => 1;
}

// ───────────── post-flop updates ─────────────

/** Likelihood of an action for each strength bucket (index = Bucket). */
const LIKELIHOOD: Record<'bet' | 'raise' | 'call' | 'check', number[]> = {
  //        air   weak  med   strong monster draw
  bet: [0.22, 0.25, 0.45, 0.85, 1.0, 0.6],
  raise: [0.08, 0.08, 0.15, 0.5, 1.0, 0.35],
  call: [0.15, 0.7, 1.0, 0.9, 0.5, 0.9],
  check: [1.0, 1.0, 1.0, 0.6, 0.35, 0.8],
};

/** Bayesian-style narrowing after a post-flop action on the given board. */
export function applyPostflopAction(r: Range, board: Card[], type: string, softness = POSTFLOP_SOFTNESS) {
  const kind = type === 'bet' ? 'bet' : type === 'raise' || type === 'allin' ? 'raise' : type === 'call' ? 'call' : type === 'check' ? 'check' : null;
  if (!kind) return;
  const lk = LIKELIHOOD[kind].map((x) => Math.max(POSTFLOP_FLOOR, Math.pow(x, softness)));
  const river = board.length >= 5;
  for (let k = 0; k < COMBO_COUNT; k++) {
    if (r[k] <= 0) continue;
    const b = bucketOf(classify([COMBO_A[k], COMBO_B[k]], board), river);
    r[k] *= lk[b];
  }
}

/** Buckets of every combo on a board (for fold-equity estimates). */
export function bucketsOn(board: Card[]): Uint8Array {
  const out = new Uint8Array(COMBO_COUNT);
  const river = board.length >= 5;
  for (let k = 0; k < COMBO_COUNT; k++) out[k] = bucketOf(classify([COMBO_A[k], COMBO_B[k]], board), river);
  return out;
}

export { Bucket };

// ───────────── sampling ─────────────

/** Prepared range for fast weighted sampling. */
export class RangeSampler {
  private cum: Float64Array;
  private total: number;
  constructor(r: Range) {
    this.cum = new Float64Array(COMBO_COUNT);
    let s = 0;
    for (let k = 0; k < COMBO_COUNT; k++) {
      s += r[k];
      this.cum[k] = s;
    }
    this.total = s;
  }
  get empty() {
    return this.total <= 0;
  }
  /** Weighted random combo index. */
  sample(rng: RngState): number {
    const x = (nextUint32(rng) / 4294967296) * this.total;
    let lo = 0,
      hi = COMBO_COUNT - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] > x) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}
