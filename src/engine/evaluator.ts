import type { Card } from './cards';

/**
 * Fast 5–7 card poker hand evaluator using rank bitmasks.
 *
 * The returned score is a single integer: higher is better, equal means a tie.
 *   bits 20..23 : hand category (0 = high card … 8 = straight flush)
 *   bits 0..19  : up to five 4-bit rank tie-breakers
 * No allocations happen in the hot path, which matters for the Monte Carlo
 * equity simulations run by the computer opponents.
 */

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

export const CATEGORY_KEYS = [
  'highCard',
  'pair',
  'twoPair',
  'trips',
  'straight',
  'flush',
  'fullHouse',
  'quads',
  'straightFlush',
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

const POPCOUNT = new Uint8Array(8192);
const STRAIGHT_HIGH = new Int8Array(8192);

(function initTables() {
  for (let m = 0; m < 8192; m++) {
    let c = 0;
    for (let b = 0; b < 13; b++) if (m & (1 << b)) c++;
    POPCOUNT[m] = c;
    let high = -1;
    for (let h = 12; h >= 4; h--) {
      const run = 0b11111 << (h - 4);
      if ((m & run) === run) {
        high = h;
        break;
      }
    }
    // wheel: A-2-3-4-5 (ace bit 12 + bits 0..3), high card is the five (rank 3)
    if (high < 0 && (m & 0b1000000001111) === 0b1000000001111) high = 3;
    STRAIGHT_HIGH[m] = high;
  }
})();

/** Highest `n` ranks of `mask` packed as 4-bit nibbles (most significant first). */
function topRanks(mask: number, n: number): number {
  let out = 0;
  let taken = 0;
  for (let r = 12; r >= 0 && taken < n; r--) {
    if (mask & (1 << r)) {
      out = (out << 4) | r;
      taken++;
    }
  }
  // left-align into the n-nibble slot
  return out << (4 * (n - taken));
}

/** Evaluate the best 5-card hand out of the first `len` cards (5 ≤ len ≤ 7). */
export function evaluate(cards: ArrayLike<Card>, len: number = cards.length): number {
  let s0 = 0,
    s1 = 0,
    s2 = 0,
    s3 = 0;
  for (let i = 0; i < len; i++) {
    const c = cards[i];
    const bit = 1 << (c >> 2);
    switch (c & 3) {
      case 0:
        s0 |= bit;
        break;
      case 1:
        s1 |= bit;
        break;
      case 2:
        s2 |= bit;
        break;
      default:
        s3 |= bit;
    }
  }

  // Flushes (at most one suit can have ≥5 cards out of 7)
  let flushMask = 0;
  if (POPCOUNT[s0] >= 5) flushMask = s0;
  else if (POPCOUNT[s1] >= 5) flushMask = s1;
  else if (POPCOUNT[s2] >= 5) flushMask = s2;
  else if (POPCOUNT[s3] >= 5) flushMask = s3;
  if (flushMask) {
    const sf = STRAIGHT_HIGH[flushMask];
    if (sf >= 0) return (8 << 20) | (sf << 16);
    return (5 << 20) | topRanks(flushMask, 5);
  }

  const all = s0 | s1 | s2 | s3;
  // Count multiplicities without allocating: rank appears in 1–4 suit masks.
  let quad = -1;
  let trip1 = -1,
    trip2 = -1;
  let pair1 = -1,
    pair2 = -1,
    pair3 = -1;
  for (let r = 12; r >= 0; r--) {
    const bit = 1 << r;
    if (!(all & bit)) continue;
    const cnt = (s0 & bit ? 1 : 0) + (s1 & bit ? 1 : 0) + (s2 & bit ? 1 : 0) + (s3 & bit ? 1 : 0);
    if (cnt === 4) quad = r;
    else if (cnt === 3) {
      if (trip1 < 0) trip1 = r;
      else if (trip2 < 0) trip2 = r;
    } else if (cnt === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
      else if (pair3 < 0) pair3 = r;
    }
  }

  if (quad >= 0) {
    return (7 << 20) | (quad << 16) | (topRanks(all & ~(1 << quad), 1) << 12);
  }
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
    const p = trip2 > pair1 ? trip2 : pair1;
    return (6 << 20) | (trip1 << 16) | (p << 12);
  }
  const st = STRAIGHT_HIGH[all];
  if (st >= 0) return (4 << 20) | (st << 16);
  if (trip1 >= 0) {
    return (3 << 20) | (trip1 << 16) | (topRanks(all & ~(1 << trip1), 2) << 8);
  }
  if (pair2 >= 0) {
    const kick = topRanks(all & ~(1 << pair1) & ~(1 << pair2), 1);
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (kick << 8);
  }
  if (pair1 >= 0) {
    return (1 << 20) | (pair1 << 16) | (topRanks(all & ~(1 << pair1), 3) << 4);
  }
  return topRanks(all, 5);
}

export const categoryOf = (score: number): HandCategory => (score >> 20) as HandCategory;

export interface HandDescription {
  score: number;
  category: HandCategory;
  key: CategoryKey;
  /** The five cards forming the best hand. */
  best: Card[];
}

/** Slower helper for the UI: also returns the five cards that make the best hand. */
export function describeHand(cards: Card[]): HandDescription {
  if (cards.length < 5) throw new Error('describeHand needs at least 5 cards');
  let bestScore = -1;
  let best: Card[] = [];
  const n = cards.length;
  const buf = new Array<Card>(5);
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            buf[0] = cards[a];
            buf[1] = cards[b];
            buf[2] = cards[c];
            buf[3] = cards[d];
            buf[4] = cards[e];
            const s = evaluate(buf, 5);
            if (s > bestScore) {
              bestScore = s;
              best = buf.slice();
            }
          }
  const category = categoryOf(bestScore);
  return { score: bestScore, category, key: CATEGORY_KEYS[category], best };
}
