import type { Card } from '../engine/cards';
import { evaluate } from '../engine/evaluator';

/**
 * Post-flop hand reading: how good is a hand *relative to the board*, and
 * does it have a draw? Used to narrow opponent ranges and to estimate how
 * often they continue against a bet.
 */
export const Bucket = { Air: 0, Weak: 1, Medium: 2, Strong: 3, Monster: 4, Draw: 5 } as const;
export type Bucket = (typeof Bucket)[keyof typeof Bucket];

export interface HandClass {
  /** 0 air · 1 weak pair · 2 medium pair · 3 strong (top pair good kicker, overpair) · 4 monster (two pair+ with hole cards) */
  made: 0 | 1 | 2 | 3 | 4;
  /** 0 none · 1 gutshot · 2 flush draw or open-ended · 3 combo draw */
  draw: 0 | 1 | 2 | 3;
}

function hasStraight(mask: number): boolean {
  for (let h = 12; h >= 4; h--) {
    const run = 0b11111 << (h - 4);
    if ((mask & run) === run) return true;
  }
  return (mask & 0b1000000001111) === 0b1000000001111; // wheel
}

export function classify(hole: Card[], board: Card[]): HandClass {
  const all = [...hole, ...board];
  const score = evaluate(all, all.length);
  const cat = score >> 20;
  const h1 = hole[0] >> 2;
  const h2 = hole[1] >> 2;

  // playing the board on the river: hole cards add nothing
  if (board.length === 5 && evaluate(board, 5) === score) return { made: 0, draw: 0 };

  const counts = new Uint8Array(13);
  let boardMask = 0;
  for (const c of board) {
    counts[c >> 2]++;
    boardMask |= 1 << (c >> 2);
  }
  const distinct = [...new Set(board.map((c) => c >> 2))].sort((a, b) => b - a);
  const top = distinct[0];
  const second = distinct[1] ?? -1;

  const onePair = (r: number, kicker: number): 1 | 2 | 3 => {
    if (r === top) return kicker >= 8 ? 3 : 2; // top pair, good kicker = T+
    if (r === second) return 2;
    return 1;
  };

  let made: HandClass['made'] = 0;
  if (cat >= 6 || cat === 4) made = 4;
  else if (cat === 5) {
    // flush: weak if the board carries four of the suit and we only add a small card
    const suitCount = [0, 0, 0, 0];
    for (const c of all) suitCount[c & 3]++;
    const s = suitCount.findIndex((n) => n >= 5);
    const onBoard = board.filter((c) => (c & 3) === s).length;
    const myHigh = Math.max(...hole.filter((c) => (c & 3) === s).map((c) => c >> 2), -1);
    made = onBoard >= 4 && myHigh < 9 ? 3 : 4;
  } else if (cat === 3) {
    if (h1 === h2) made = 4; // set
    else if (counts[h1] === 2 || counts[h2] === 2) {
      const kicker = counts[h1] === 2 ? h2 : h1;
      made = kicker >= 8 ? 4 : 3;
    } else made = 0; // trips on the board
  } else if (cat === 2) {
    const paired = [h1, h2].filter((r) => counts[r] >= 1);
    if (h1 !== h2 && paired.length === 2) made = 4;
    else if (h1 === h2) made = h1 > top ? 3 : 1;
    else if (paired.length === 1) made = onePair(paired[0], paired[0] === h1 ? h2 : h1);
    else made = 0; // two pair on the board
  } else if (cat === 1) {
    if (h1 === h2) made = h1 > top ? 3 : h1 > second ? 2 : 1;
    else if (counts[h1]) made = onePair(h1, h2);
    else if (counts[h2]) made = onePair(h2, h1);
    else made = 0; // the pair is on the board
  }

  let draw: HandClass['draw'] = 0;
  if (board.length < 5 && made < 4) {
    const suitAll = [0, 0, 0, 0];
    for (const c of all) suitAll[c & 3]++;
    const flushDraw = hole.some((c) => suitAll[c & 3] === 4);
    const mask = boardMask | (1 << h1) | (1 << h2);
    let outs = 0;
    for (let r = 0; r < 13; r++) {
      if (mask & (1 << r)) continue;
      if (hasStraight(mask | (1 << r)) && !hasStraight(boardMask | (1 << r))) outs++;
    }
    const oesd = outs >= 2;
    draw = flushDraw && outs >= 1 ? 3 : flushDraw || oesd ? 2 : outs === 1 ? 1 : 0;
  }
  return { made, draw };
}

export function bucketOf(c: HandClass, river: boolean): Bucket {
  if (c.made === 4) return Bucket.Monster;
  if (c.made === 3) return Bucket.Strong;
  if (!river && c.draw >= 2) return Bucket.Draw;
  if (c.made === 2) return Bucket.Medium;
  if (c.made === 1) return Bucket.Weak;
  return Bucket.Air;
}
