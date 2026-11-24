// Messages between the LAN server (inside `vite preview`) and the browsers.
// Server → browser: one `LanMessage` per change over Server-Sent Events.
// Browser → server: small JSON POSTs to /api/lan/<command>.

import type { PlayerAction } from '../../engine/types';
import type { TableView } from '../../engine/view';
import type { GameSetup, LoggedEvent } from '../types';

export const LAN_API = 'api/lan';
export const MAX_PLAYERS = 8;

export interface LanMember {
  id: string;
  name: string;
  online: boolean;
  isAdmin: boolean;
}

/** One player's personal view of the running table (never contains other players' hidden cards). */
export interface ViewPayload {
  view: TableView;
  /** Events of the latest state change (sounds, animations). */
  events: LoggedEvent['event'][];
  /** The most recent log entries – merge by id. */
  log: LoggedEvent[];
  thinkingId: string | null;
  /** Win-chance display allowed by the admin for this tournament. */
  winChance: boolean;
  turn: { playerId: string; remainingMs: number | null } | null;
}

export interface LanMessage {
  you: {
    id: string;
    isAdmin: boolean;
    /** Signed up (in the foyer or for the next tournament). */
    member: boolean;
    /** Has a seat at the running table. */
    seated: boolean;
  };
  phase: 'lobby' | 'playing';
  /** Counts up with every tournament, so clients can tell a new one apart. */
  tournament: number;
  adminId: string | null;
  members: LanMember[];
  /** The admin's current tournament settings (shown to everybody in the foyer). */
  setup: GameSetup | null;
  /** The running table, if any. */
  game: ViewPayload | null;
  /** The admin is not connected: unless they come back, the tournament is reset in … */
  adminAway: { resetInMs: number } | null;
}

export type LanCommand =
  | { cmd: 'join'; name: string }
  | { cmd: 'setup'; setup: GameSetup }
  | { cmd: 'start' }
  | { cmd: 'act'; action: PlayerAction }
  | { cmd: 'leave' }
  | { cmd: 'end' }
  /** The page is being closed (sent with navigator.sendBeacon). */
  | { cmd: 'bye' }
  /** A problem on the device (e.g. the 3D view failed) – printed in the server console. */
  | { cmd: 'log'; text: string };

export type LanResult = { ok: true } | { ok: false; error: 'notAdmin' | 'full' | 'badRequest' | 'notPlaying' | 'illegal' };
