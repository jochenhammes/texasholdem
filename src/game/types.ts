import type { Difficulty, Personality } from '../ai/profiles';
import type { BlindSpeed } from '../engine/tournament';
import type { GameEvent, PlayerAction, PlayerId } from '../engine/types';
import type { TableView } from '../engine/view';

export interface GameSetup {
  playerName: string;
  /** Total players at the table including the human (2–8). */
  totalPlayers: number;
  difficulty: Difficulty;
  startingStack: number;
  blindSpeed: BlindSpeed;
  /** Starting blind level (index into the blind structure, 0 = lowest). */
  startLevel?: number;
}

export interface LoggedEvent {
  id: number;
  hand: number;
  event: GameEvent;
}

/** Everything the UI needs to render one frame of the game. */
export interface GameSnapshot {
  view: TableView;
  /** Events produced by the last state change (drive sounds and effects). */
  events: GameEvent[];
  log: LoggedEvent[];
  /** Bot currently "thinking". */
  thinkingId: PlayerId | null;
  /** The human has busted out but the tournament goes on. */
  heroEliminated: boolean;
  /** The human has decided to keep watching after busting out. */
  spectating: boolean;
  paused: boolean;
  personalities: Record<PlayerId, Personality>;
  /** Whose decision is pending and until when (multiplayer time limit). */
  turn: { playerId: PlayerId; deadline: number | null } | null;
  /** Multiplayer: the host is not connected, the table waits. */
  hostAway?: boolean;
  /** Multiplayer: the host closed the table. */
  closed?: boolean;
  /** Multiplayer info for menus (null in single player). */
  multiplayer?: { room: string; isHost: boolean } | null;
}

/**
 * The boundary between UI and game logic. Today the only implementation is
 * `LocalGameController` (engine + bots in the browser). A future
 * `RemoteGameController` can implement the same interface on top of a
 * WebSocket connection to an authoritative server — the UI will not change.
 */
export interface GameController {
  /** Svelte store contract: called immediately and on every change. */
  subscribe(run: (snap: GameSnapshot) => void): () => void;
  act(action: PlayerAction): void;
  setPaused(paused: boolean): void;
  /** Keep watching the bots after the human busted out. */
  spectate(): void;
  dispose(): void;
}
