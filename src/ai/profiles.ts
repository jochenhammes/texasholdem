import { nextInt, type RngState } from '../engine/rng';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Personality = 'rock' | 'tag' | 'lag' | 'station' | 'maniac';

export interface BotProfile {
  difficulty: Difficulty;
  personality: Personality;
  /** Monte Carlo samples per decision. */
  iterations: number;
  /** Std-dev of random noise added to the equity estimate (mistakes). */
  noise: number;
  /** 0…1: how much opponents' actions narrow their assumed range. */
  rangeAwareness: number;
  /** Shifts value/call thresholds; positive = tighter. */
  tightness: number;
  /** Probability of betting/raising strong hands instead of calling/checking. */
  aggression: number;
  /** Base bluff frequency. */
  bluff: number;
  /** Extra equity required (or granted when negative) before calling. */
  callMargin: number;
  /** Uses short-stack push/fold play. */
  pushFold: boolean;
  /** Probability of trapping with monsters. */
  slowplay: number;
}

/**
 * Three levels:
 *  - easy   – solid threshold bots with distinct personalities (and mistakes)
 *  - medium – range-aware threshold bots, push/fold when short
 *  - hard   – the range/EV engine in expert.ts, adapting to observed opponents
 */
const BASE: Record<Difficulty, Omit<BotProfile, 'personality' | 'difficulty'>> = {
  easy: {
    iterations: 500,
    noise: 0.07,
    rangeAwareness: 0.5,
    tightness: 0.02,
    aggression: 0.6,
    bluff: 0.08,
    callMargin: 0.0,
    pushFold: true,
    slowplay: 0.08,
  },
  medium: {
    iterations: 1200,
    noise: 0.03,
    rangeAwareness: 1,
    tightness: 0.03,
    aggression: 0.75,
    bluff: 0.11,
    callMargin: 0.02,
    pushFold: true,
    slowplay: 0.15,
  },
  // iterations = Monte Carlo budget per decision of the expert engine
  hard: {
    iterations: 5000,
    noise: 0,
    rangeAwareness: 1,
    tightness: 0,
    aggression: 0.8,
    bluff: 0.1,
    callMargin: 0,
    pushFold: true,
    slowplay: 0.1,
  },
};

const STYLE: Record<Personality, { tight: number; aggr: number; bluff: number; call: number }> = {
  rock: { tight: 0.07, aggr: 0.75, bluff: 0.4, call: 0.03 },
  tag: { tight: 0.03, aggr: 1.15, bluff: 1, call: 0.01 },
  lag: { tight: -0.04, aggr: 1.3, bluff: 1.6, call: -0.02 },
  station: { tight: -0.02, aggr: 0.55, bluff: 0.4, call: -0.07 },
  maniac: { tight: -0.08, aggr: 1.6, bluff: 2.6, call: -0.04 },
};

const POOLS: Record<Difficulty, Personality[]> = {
  easy: ['rock', 'tag', 'lag', 'station', 'maniac', 'tag'],
  medium: ['tag', 'lag', 'tag', 'rock', 'lag'],
  hard: ['tag'],
};

export function makeProfile(difficulty: Difficulty, personality: Personality): BotProfile {
  const b = BASE[difficulty];
  const st = STYLE[personality];
  return {
    ...b,
    difficulty,
    personality,
    tightness: b.tightness + st.tight,
    aggression: Math.min(0.95, b.aggression * st.aggr),
    bluff: Math.min(0.35, b.bluff * st.bluff),
    callMargin: b.callMargin + st.call,
  };
}

export function randomPersonality(difficulty: Difficulty, rng: RngState): Personality {
  const pool = POOLS[difficulty];
  return pool[nextInt(rng, pool.length)];
}
