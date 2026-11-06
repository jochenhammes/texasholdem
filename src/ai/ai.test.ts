import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards';
import { advance, applyAction, createTournament, totalChips } from '../engine/engine';
import { seedRng } from '../engine/rng';
import { makeTournamentConfig } from '../engine/tournament';
import { toView } from '../engine/view';
import { decide, type HandAction } from './decide';
import { chenScore, monteCarloEquity } from './equity';
import { makeProfile, type Difficulty, type Personality } from './profiles';

describe('equity', () => {
  it('AA vs one random hand is about 85%', () => {
    const eq = monteCarloEquity({ hero: parseCards('As Ah'), board: [], opponentMinChen: [-10], iterations: 4000 }, seedRng(1));
    expect(eq).toBeGreaterThan(0.81);
    expect(eq).toBeLessThan(0.89);
  });
  it('a made nut flush is almost a lock', () => {
    const eq = monteCarloEquity(
      { hero: parseCards('Ah Kh'), board: parseCards('2h 7h 9h Jc 3d'), opponentMinChen: [-10, -10], iterations: 2000 },
      seedRng(2),
    );
    expect(eq).toBeGreaterThan(0.97);
  });
  it('chen scores', () => {
    expect(chenScore(...(parseCards('As Ah') as [number, number]))).toBe(20);
    expect(chenScore(...(parseCards('Ks Kh') as [number, number]))).toBe(16);
    expect(chenScore(...(parseCards('7c 2d') as [number, number]))).toBeLessThan(2);
  });
});

function runBotTournament(players: { diff: Difficulty; pers: Personality }[], seed: number) {
  const entrants = players.map((_, i) => ({ id: `b${i}`, name: `B${i}`, kind: 'bot' as const }));
  const s = createTournament(makeTournamentConfig(1500, 'turbo'), entrants, seed);
  const profiles = players.map((p) => makeProfile(p.diff, p.pers));
  let history: HandAction[] = [];
  let steps = 0;
  let seq = seed;
  while (s.phase !== 'tournamentComplete') {
    if (++steps > 50000) throw new Error('did not finish');
    if (s.phase === 'betting') {
      const p = s.players[s.toAct];
      const view = toView(s, p.id);
      const { action } = decide({ view, profile: { ...profiles[p.seat], iterations: 60 }, history, seed: seq++ });
      applyAction(s, p.id, action);
      history.push({ playerId: p.id, street: s.street, type: p.lastAction!.type });
    } else {
      if (s.phase === 'handComplete') history = [];
      advance(s);
    }
  }
  expect(totalChips(s)).toBe(1500 * players.length);
  return s;
}

describe('bots', () => {
  it('play complete tournaments with only legal actions', () => {
    const pers: Personality[] = ['rock', 'tag', 'lag', 'station', 'maniac'];
    const diffs: Difficulty[] = ['easy', 'medium', 'hard'];
    for (let t = 0; t < 6; t++) {
      const n = 2 + t;
      const players = Array.from({ length: n }, (_, i) => ({ diff: diffs[(i + t) % 3], pers: pers[(i * 2 + t) % 5] }));
      const s = runBotTournament(players, 100 + t);
      expect(s.placements).toHaveLength(n);
      expect(s.handNumber).toBeGreaterThan(1);
    }
  }, 60000);

  it('folds trash and raises aces pre-flop (hard)', () => {
    const s = createTournament(makeTournamentConfig(1500, 'normal'), [
      { id: 'a', name: 'A', kind: 'bot' },
      { id: 'b', name: 'B', kind: 'bot' },
      { id: 'c', name: 'C', kind: 'bot' },
      { id: 'd', name: 'D', kind: 'bot' },
    ], 5);
    advance(s);
    const p = s.players[s.toAct];
    const profile = makeProfile('hard', 'tag');
    p.holeCards = parseCards('As Ad');
    let raises = 0;
    for (let i = 0; i < 20; i++) if (decide({ view: toView(s, p.id), profile, history: [], seed: i }).action.type === 'raise') raises++;
    expect(raises).toBeGreaterThan(14);
    p.holeCards = parseCards('7c 2d');
    let folds = 0;
    for (let i = 0; i < 20; i++) if (decide({ view: toView(s, p.id), profile, history: [], seed: i }).action.type === 'fold') folds++;
    expect(folds).toBeGreaterThan(16);
  });
});
