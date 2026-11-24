export type AnimSpeed = 'relaxed' | 'normal' | 'fast';
/** `table`: dark poker table (default). `clean`: sober layout without a table, follows the system light/dark mode. */
export type Theme = 'table' | 'clean';
/** `2d`: the standard table view. `3d`: a realistic 3D poker table (three.js). */
export type TableView3D = '2d' | '3d';

export interface Settings {
  fourColor: boolean;
  sound: boolean;
  animSpeed: AnimSpeed;
  handHints: boolean;
  /** Show the own chance to win the hand (Monte Carlo against random hands). Off by default. */
  winChance: boolean;
  /** Stop after every showdown with the cards face up until the player continues. */
  pauseAtShowdown: boolean;
  theme: Theme;
  view: TableView3D;
  /** Simple 3D rendering for older devices (no shadows, no depth of field). */
  lite3d: boolean;
}

const KEY = 'holdem.settings.v1';
const DEFAULTS: Settings = { fourColor: false, sound: true, animSpeed: 'normal', handHints: true, winChance: false, theme: 'table', pauseAtShowdown: true, view: '2d', lite3d: false };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

/** Reactive, persisted user preferences. */
export const settings = $state<Settings>(load());

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export const SPEED_FACTOR: Record<AnimSpeed, number> = { relaxed: 1.4, normal: 1, fast: 0.5 };
