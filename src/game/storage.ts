import type { Personality } from '../ai/profiles';
import type { HandAction } from '../ai/decide';
import type { TableState } from '../engine/types';
import type { GameSetup, LoggedEvent } from './types';

/**
 * Local persistence (localStorage). Kept behind a tiny interface so it can be
 * swapped for an account-backed API later.
 */
const GAME_KEY = 'holdem.savedGame.v1';
const SETUP_KEY = 'holdem.lastSetup.v1';
const STATS_KEY = 'holdem.stats.v1';

export interface SavedGame {
  version: 1;
  savedAt: number;
  setup: GameSetup;
  state: TableState;
  personalities: Record<string, Personality>;
  history: HandAction[];
  log: LoggedEvent[];
  statsRecorded?: boolean;
  oppStats?: import('../ai/opponentStats').StatsTable;
}

export interface Stats {
  tournaments: number;
  wins: number;
  bestPlace: number | null;
  handsPlayed: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable (private mode) – the game still works */
  }
}

export const storage = {
  loadGame: () => {
    const g = read<SavedGame>(GAME_KEY);
    return g && g.version === 1 && g.state?.version === 1 ? g : null;
  },
  saveGame: (g: SavedGame) => write(GAME_KEY, g),
  clearGame: () => {
    try {
      localStorage.removeItem(GAME_KEY);
    } catch {
      /* ignore */
    }
  },
  loadSetup: () => read<GameSetup>(SETUP_KEY),
  saveSetup: (s: GameSetup) => write(SETUP_KEY, s),
  loadStats: (): Stats => read<Stats>(STATS_KEY) ?? { tournaments: 0, wins: 0, bestPlace: null, handsPlayed: 0 },
  saveStats: (s: Stats) => write(STATS_KEY, s),
};
