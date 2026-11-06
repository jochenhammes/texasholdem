import type { Card } from '../engine/cards';
import { evaluate } from '../engine/evaluator';
import { nextUint32, type RngState } from '../engine/rng';

/**
 * Chen formula: a quick pre-flop hand score (-1 … 20). Used to model opponent
 * ranges ("this player raised, so they likely hold a hand scoring ≥ 7").
 */
export function chenScore(a: Card, b: Card): number {
  let r1 = a >> 2,
    r2 = b >> 2;
  if (r2 > r1) [r1, r2] = [r2, r1];
  const base = (r: number) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  let score = base(r1);
  if (r1 === r2) return Math.max(5, Math.ceil(score * 2));
  if ((a & 3) === (b & 3)) score += 2;
  const gap = r1 - r2 - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && r1 < 10) score += 1;
  return Math.ceil(score);
}

const CHEN = new Int8Array(52 * 52);
for (let a = 0; a < 52; a++) for (let b = 0; b < 52; b++) if (a !== b) CHEN[a * 52 + b] = chenScore(a, b);

export interface EquityRequest {
  hero: Card[];
  board: Card[];
  /** One entry per opponent: minimum Chen score of their assumed range (-10 = any two cards). */
  opponentMinChen: number[];
  iterations: number;
}

/**
 * Monte Carlo equity: share of the pot the hero wins on average against the
 * given opponents (ties count fractionally). Allocation-free inner loop.
 */
export function monteCarloEquity(req: EquityRequest, rng: RngState): number {
  const { hero, board, opponentMinChen, iterations } = req;
  const nOpp = opponentMinChen.length;
  if (nOpp === 0) return 1;
  const dead = new Uint8Array(52);
  for (const c of hero) dead[c] = 1;
  for (const c of board) dead[c] = 1;
  const live: number[] = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) live.push(c);
  const liveN = live.length;

  const used = new Uint32Array(52); // stamp per iteration
  const heroCards = new Int32Array(7);
  const oppCards = new Int32Array(7);
  const fullBoard = new Int32Array(5);
  const opp = new Int32Array(nOpp * 2);
  for (let i = 0; i < board.length; i++) fullBoard[i] = board[i];
  heroCards[0] = hero[0];
  heroCards[1] = hero[1];
  const need = 5 - board.length;

  let total = 0;
  for (let it = 1; it <= iterations; it++) {
    const stamp = it;
    const draw = () => {
      for (;;) {
        const c = live[nextUint32(rng) % liveN];
        if (used[c] !== stamp) {
          used[c] = stamp;
          return c;
        }
      }
    };
    // opponents first (range-weighted by rejection sampling)
    for (let o = 0; o < nOpp; o++) {
      const min = opponentMinChen[o];
      let c1 = draw();
      let c2 = draw();
      for (let tries = 0; tries < 25 && CHEN[c1 * 52 + c2] < min; tries++) {
        used[c1] = 0;
        used[c2] = 0;
        c1 = draw();
        c2 = draw();
      }
      opp[o * 2] = c1;
      opp[o * 2 + 1] = c2;
    }
    for (let i = 0; i < need; i++) fullBoard[board.length + i] = draw();
    for (let i = 0; i < 5; i++) heroCards[2 + i] = oppCards[2 + i] = fullBoard[i];

    const heroScore = evaluate(heroCards, 7);
    let best = 0;
    let ties = 0;
    let lost = false;
    for (let o = 0; o < nOpp; o++) {
      oppCards[0] = opp[o * 2];
      oppCards[1] = opp[o * 2 + 1];
      const sc = evaluate(oppCards, 7);
      if (sc > heroScore) {
        lost = true;
        break;
      }
      if (sc === heroScore) ties++;
      if (sc > best) best = sc;
    }
    if (!lost) total += 1 / (ties + 1);
  }
  return total / iterations;
}
