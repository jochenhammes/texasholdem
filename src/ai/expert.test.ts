import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards';
import { advance, applyAction, createTournament, startHand, totalChips } from '../engine/engine';
import { makeTournamentConfig } from '../engine/tournament';
import { toView } from '../engine/view';
import type { TableState } from '../engine/types';
import { decide, type HandAction } from './decide';
import { Bucket, bucketOf, classify } from './handClass';
import { makeProfile } from './profiles';
import { handPct } from './ranges';

const c = parseCards;

describe('hand classification', () => {
  it.each([
    ['As Kd', '2c 7h Ah', 3, 0], // top pair, top kicker
    ['As 4d', '2c 7h Ah', 2, 0], // top pair, weak kicker
    ['Qs Qd', '2c 7h 9h', 3, 0], // overpair
    ['7s 7d', '2c 7h 9h', 4, 0], // set
    ['8s 6d', '2c 7h 9h', 0, 1], // gutshot (needs a 5 or T → open-ended actually)
    ['Ks Qs', '2s 7s 9h', 0, 2], // flush draw
    ['Js Ts', '9s 8c 2s', 0, 3], // combo draw
    ['3c 2d', 'Ah Ad Kc Ks Qh', 0, 0], // playing the board
  ])('%s on %s', (hole, board, made, minDraw) => {
    const r = classify(c(hole), c(board));
    expect(r.made).toBe(made);
    expect(r.draw).toBeGreaterThanOrEqual(minDraw);
  });
  it('buckets', () => {
    expect(bucketOf(classify(c('Ks Qs'), c('2s 7s 9h')), false)).toBe(Bucket.Draw);
    expect(bucketOf(classify(c('Ks Qs'), c('2s 7s 9h 3d 4c')), true)).toBe(Bucket.Air);
  });
  it('pre-flop percentiles are sensible', () => {
    expect(handPct(c('As')[0], c('Ah')[0])).toBeLessThan(0.01);
    expect(handPct(c('7c')[0], c('2d')[0])).toBeGreaterThan(0.95);
    expect(handPct(c('Ks')[0], c('Qs')[0])).toBeLessThan(handPct(c('Kd')[0], c('Qc')[0]));
  });
});

const expert = makeProfile('hard', 'tag');

function table(n: number, seed = 3): TableState {
  return createTournament(makeTournamentConfig(1500, 'normal'), Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, kind: 'bot' as const })), seed);
}

function decideN(s: TableState, history: HandAction[] = [], n = 20) {
  const p = s.players[s.toAct];
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const a = decide({ view: toView(s, p.id), profile: { ...expert, iterations: 800 }, history, seed: i }).action;
    out[a.type] = (out[a.type] ?? 0) + 1;
  }
  return out;
}

describe('expert sanity', () => {
  it('opens aces and folds 7-2 under the gun', () => {
    const s = table(6);
    startHand(s);
    const p = s.players[s.toAct];
    p.holeCards = c('As Ad');
    expect(decideN(s).raise).toBe(20);
    p.holeCards = c('7c 2d');
    expect(decideN(s).fold).toBe(20);
  });

  it('never folds the nuts on the river', () => {
    const s = table(2, 9);
    startHand(s);
    // call / check to the river
    while (s.street !== 'river' || s.phase !== 'betting') {
      if (s.phase === 'betting') applyAction(s, s.players[s.toAct].id, s.players[s.toAct].bet < s.currentBet ? { type: 'call' } : { type: 'check' });
      else advance(s);
    }
    const me = s.players[s.toAct];
    s.board = c('Ah Kh Qh 2c 3d');
    me.holeCards = c('Jh Th');
    const other = s.players.find((x) => x !== me)!;
    other.holeCards = c('As Ac');
    const res = decideN(s, [], 10);
    expect(res.fold ?? 0).toBe(0);
    expect(res.raise ?? 0).toBeGreaterThan(5); // bets the royal flush for value
  });

  it('shoves short stacks with strong hands and folds trash', () => {
    const s = table(4, 5);
    s.players.forEach((p) => (p.stack = 150)); // 7.5 BB
    startHand(s);
    const p = s.players[s.toAct];
    p.holeCards = c('Ks Qs');
    expect(decideN(s).raise).toBeGreaterThan(15);
    p.holeCards = c('8c 3d');
    expect(decideN(s).fold).toBeGreaterThan(15);
  });

  it('plays complete tournaments with legal actions only', () => {
    for (let t = 0; t < 3; t++) {
      const s = createTournament(makeTournamentConfig(1500, 'turbo'), Array.from({ length: 4 + t }, (_, i) => ({ id: `p${i}`, name: '', kind: 'bot' as const })), 77 + t);
      const profiles = s.players.map((_, i) => (i % 2 ? makeProfile('medium', 'tag') : { ...expert, iterations: 300 }));
      let history: HandAction[] = [];
      let guard = 0;
      while (s.phase !== 'tournamentComplete' && guard++ < 30000) {
        if (s.phase === 'betting') {
          const p = s.players[s.toAct];
          const { action } = decide({ view: toView(s, p.id), profile: { ...profiles[p.seat], iterations: Math.min(profiles[p.seat].iterations, 300) }, history, seed: guard });
          applyAction(s, p.id, action);
          history.push({ playerId: p.id, street: s.street, type: p.lastAction!.type, amount: p.lastAction!.amount });
        } else {
          if (s.phase === 'handComplete') history = [];
          advance(s);
        }
      }
      expect(s.phase).toBe('tournamentComplete');
      expect(totalChips(s)).toBe(1500 * s.players.length);
    }
  }, 120000);
});
