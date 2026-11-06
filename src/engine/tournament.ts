import type { BlindLevel, TournamentConfig } from './types';

/** Classic Sit & Go blind structure (multiplied for larger starting stacks). */
const BASE_LEVELS: [number, number, number][] = [
  [10, 20, 0],
  [15, 30, 0],
  [25, 50, 0],
  [50, 100, 0],
  [75, 150, 0],
  [100, 200, 25],
  [150, 300, 25],
  [200, 400, 50],
  [300, 600, 75],
  [400, 800, 100],
  [600, 1200, 150],
  [800, 1600, 200],
  [1000, 2000, 250],
  [1500, 3000, 400],
  [2000, 4000, 500],
  [3000, 6000, 750],
  [4000, 8000, 1000],
  [6000, 12000, 1500],
  [8000, 16000, 2000],
  [10000, 20000, 3000],
];

export type BlindSpeed = 'turbo' | 'normal' | 'slow';
export const HANDS_PER_LEVEL: Record<BlindSpeed, number> = { turbo: 6, normal: 10, slow: 15 };
export const STARTING_STACKS = [1000, 1500, 3000, 5000] as const;

export function blindLevels(startingStack: number): BlindLevel[] {
  // keep roughly the same stack-to-blind ratio (75 BB at 1500) for every stack size
  const factor = Math.max(1, Math.round(startingStack / 1500));
  return BASE_LEVELS.map(([sb, bb, ante]) => ({ sb: sb * factor, bb: bb * factor, ante: ante * factor }));
}

export function makeTournamentConfig(startingStack: number, speed: BlindSpeed): TournamentConfig {
  return {
    startingStack,
    handsPerLevel: HANDS_PER_LEVEL[speed],
    levels: blindLevels(startingStack),
  };
}

export function levelForHand(config: TournamentConfig, handNumber: number): number {
  const idx = Math.floor(Math.max(0, handNumber - 1) / config.handsPerLevel);
  return Math.min(idx, config.levels.length - 1);
}
